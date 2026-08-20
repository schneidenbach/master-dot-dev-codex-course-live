import {
  chromium,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import pg from 'pg';

const baseURL = 'http://localhost:5103';
const databaseURL = process.env.DATABASE_URL
  ?? 'postgres://auction:auction@127.0.0.1:55432/auction_part_3';
const holdOpenMs = Number(process.env.BIDDING_WAR_HOLD_MS ?? 0);
const screenWidth = Number(process.env.BIDDING_WAR_SCREEN_WIDTH ?? 1_440);
const screenHeight = Number(process.env.BIDDING_WAR_SCREEN_HEIGHT ?? 900);
const menuBarHeight = 25;
const tileWidth = Math.floor(screenWidth / 2);
const tileHeight = Math.floor((screenHeight - menuBarHeight) / 2);
const secondRowTop = menuBarHeight + tileHeight;

type Competitor = {
  name: string;
  userId: number;
  color: string;
  position: [number, number];
};

const seller: Competitor = {
  name: 'SELLER · AVERY', userId: 1, color: '#155eef', position: [0, menuBarHeight],
};
const bidders: Competitor[] = [
  { name: 'BIDDER 1 · MAYA', userId: 2, color: '#7f56d9', position: [tileWidth, menuBarHeight] },
  { name: 'BIDDER 2 · THEO', userId: 3, color: '#db2777', position: [0, secondRowTop] },
  { name: 'BIDDER 3 · PRIYA', userId: 4, color: '#ea580c', position: [tileWidth, secondRowTop] },
];

async function launchWindow(
  competitor: Competitor,
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: null });
  await context.addInitScript((userId: number) => {
    window.sessionStorage.setItem('auction-house-active-user-id', String(userId));
  }, competitor.userId);
  const page = await context.newPage();
  return { context, page };
}

async function decorate(
  page: Page,
  competitor: Competitor,
  deadlineMs: number | null,
  status: string,
) {
  await page.evaluate(({ label, color, deadline, message }) => {
    document.querySelector('[data-bidding-war-hud]')?.remove();
    document.querySelector('[data-bidding-war-style]')?.remove();

    const style = document.createElement('style');
    style.dataset.biddingWarStyle = 'true';
    style.textContent = `
      .site-header nav, .item-gallery, .breadcrumbs, .seller-card,
      .item-details-grid, footer { display: none !important; }
      .site-header { position: fixed; inset: 0 0 auto; z-index: 20; }
      .header-main { min-height: 58px !important; padding-block: 8px !important; }
      .item-page { max-width: none !important; padding: 82px 18px 12px !important; }
      .item-layout { display: block !important; }
      .item-summary h1 { margin: 2px 0 5px !important; font-size: 24px !important; }
      .item-kicker, .product-category { margin-block: 3px !important; }
      .auction-panel { padding: 13px !important; }
      .current-price strong { font-size: 28px !important; }
      .bid-history-section { margin-top: 12px !important; padding: 12px 16px !important; }
      .bid-history-heading { margin-bottom: 7px !important; }
      .bid-history-list article { padding: 6px 0 !important; }
      [data-bidding-war-hud] { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    `;
    document.head.append(style);

    const hud = document.createElement('aside');
    hud.dataset.biddingWarHud = 'true';
    hud.style.cssText = `position:fixed;z-index:1000;right:12px;top:67px;width:225px;
      padding:10px 12px;border:2px solid ${color};border-radius:10px;background:#fffffff2;
      box-shadow:0 8px 30px #10182833;color:#101828;pointer-events:none`;
    hud.innerHTML = `<strong style="display:block;color:${color};font-size:13px">${label}</strong>
      <span data-war-clock style="display:block;margin:4px 0;font-size:25px;font-weight:900">READY</span>
      <span data-war-status style="font-size:11px;font-weight:700">${message}</span>`;
    document.body.append(hud);

    if (deadline) {
      let clockInterval: number | undefined;
      const renderClock = () => {
        const remaining = (deadline - Date.now()) / 1000;
        const clock = hud.querySelector<HTMLElement>('[data-war-clock]');
        if (!clock) return;
        if (remaining <= 0) {
          clock.textContent = 'ENDED';
          clock.style.color = '#b42318';
          if (clockInterval !== undefined) window.clearInterval(clockInterval);
          return;
        }
        clock.textContent = `T−${remaining.toFixed(1)}s`;
        clock.style.color = remaining < 5 ? '#dc6803' : '#101828';
      };
      renderClock();
      if (deadline > Date.now()) clockInterval = window.setInterval(renderClock, 100);
    }
  }, {
    label: competitor.name,
    color: competitor.color,
    deadline: deadlineMs,
    message: status,
  });
}

async function setStatus(page: Page, status: string) {
  await page.locator('[data-war-status]').evaluate((element, text) => {
    element.textContent = String(text);
  }, status);
}

async function syncAuction(
  windows: Array<{ page: Page; competitor: Competitor }>,
  url: string,
  deadlineMs: number,
  status: string,
) {
  await Promise.all(windows.map(async ({ page, competitor }) => {
    await page.goto(url);
    await page.getByRole('heading', { name: /^BIDDING WAR/ }).waitFor();
    await decorate(page, competitor, deadlineMs, status);
  }));
}

async function bid(page: Page, amount: string, status: string) {
  await setStatus(page, status);
  await page.getByLabel('Your bid').fill(amount);
  await page.getByRole('button', { name: 'Place bid' }).click();
  const message = page.locator('.bid-message');
  await expect(message).toBeVisible();
  return {
    kind: await message.evaluate((element) => element.classList.contains('error') ? 'error' : 'success'),
    message: await message.textContent(),
  };
}

async function waitUntil(deadlineMs: number, secondsRemaining: number) {
  const delay = deadlineMs - Date.now() - secondsRemaining * 1_000;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

async function tileWindows(
  windows: Array<{ page: Page; competitor: Competitor }>,
) {
  await Promise.all(windows.map(async ({ page, competitor }) => {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    const [left, top] = competitor.position;
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'normal' },
    });
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left, top, width: tileWidth, height: tileHeight },
    });
    await session.detach();
  }));
}

test('Bidding War: four visible users are protected from simultaneous-bid races', async () => {
  test.setTimeout(holdOpenMs > 0 ? holdOpenMs + 120_000 : 90_000);
  const database = new pg.Pool({ connectionString: databaseURL });
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: false,
    args: [
      `--window-size=${tileWidth},${tileHeight}`,
      '--disable-session-crashed-bubble',
      '--no-first-run',
    ],
  });
  const launched: Array<{ context: BrowserContext; page: Page; competitor: Competitor }> = [];
  let triggerInstalled = false;

  try {
    for (const competitor of [seller, ...bidders]) {
      const window = await launchWindow(competitor, browser);
      launched.push({ ...window, competitor });
    }
    await tileWindows(launched);

    const sellerPage = launched[0].page;
    await sellerPage.goto(`${baseURL}/auctions/new`);
    await sellerPage.getByRole('heading', { name: 'Give good hardware a second life.' }).waitFor();
    await decorate(sellerPage, seller, null, 'Creating the 20-second battleground…');

    const title = `BIDDING WAR GPU ${Date.now()}`;
    await sellerPage.getByLabel('Title').fill(title);
    await sellerPage.getByLabel('Description').fill(
      'A deliberately frantic auction used to expose concurrent bid acceptance.',
    );
    await sellerPage.getByLabel('Starting price').fill('100.00');
    await sellerPage.getByLabel('Item location').fill('Chaos Arena, IL');
    const safeClosingTime = new Date(Date.now() + 180_000);
    const localClosingTime = new Date(
      safeClosingTime.getTime() - safeClosingTime.getTimezoneOffset() * 60_000,
    ).toISOString().slice(0, 16);
    await sellerPage.getByLabel('Closing time').fill(localClosingTime);
    await sellerPage.getByRole('button', { name: 'Post auction' }).click();
    await sellerPage.waitForURL(/\/items\//);

    const slug = decodeURIComponent(new URL(sellerPage.url()).pathname.split('/').pop() ?? '');
    const deadlineMs = Date.now() + 20_000;
    await database.query(
      'UPDATE auctions SET ends_at = $1 WHERE slug = $2',
      [new Date(deadlineMs), slug],
    );

    await database.query(`
      CREATE OR REPLACE FUNCTION bidding_war_delay_insert() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM auctions
          WHERE id = NEW.auction_id AND title LIKE 'BIDDING WAR GPU %'
        ) THEN
          PERFORM pg_sleep(0.8);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS bidding_war_delay_insert ON bids;
      CREATE TRIGGER bidding_war_delay_insert
        BEFORE INSERT ON bids
        FOR EACH ROW EXECUTE FUNCTION bidding_war_delay_insert();
    `);
    triggerInstalled = true;

    const auctionURL = `${baseURL}/items/${slug}`;
    const visibleWindows = launched.map(({ page, competitor }) => ({ page, competitor }));
    await syncAuction(visibleWindows, auctionURL, deadlineMs, 'Auction live — watch the bid history!');

    const bidderPages = launched.slice(1).map(({ page }) => page);

    await waitUntil(deadlineMs, 16);
    await bid(bidderPages[0], '101.00', 'Maya opens at $101…');
    await syncAuction(visibleWindows, auctionURL, deadlineMs, 'Maya leads at $101');

    await waitUntil(deadlineMs, 12);
    const equalResults = await Promise.all([
      bid(bidderPages[1], '102.00', '⚔ SAME-TIME $102 — FIRE!'),
      bid(bidderPages[2], '102.00', '⚔ SAME-TIME $102 — FIRE!'),
    ]);
    expect(equalResults.filter((result) => result.kind === 'success')).toHaveLength(1);
    expect(equalResults.filter((result) => result.kind === 'error')).toHaveLength(1);
    const staleBidIndex = equalResults.findIndex((result) => result.kind === 'error');
    const staleBidPage = bidderPages[staleBidIndex + 1];
    await expect(staleBidPage.getByLabel('Your bid')).toHaveValue('102.00');
    await expect(staleBidPage.locator('.current-price strong')).toHaveText('$102');
    await expect(staleBidPage.locator('.bid-guidance')).toHaveText('Minimum bid $103');
    await expect(staleBidPage.locator('.bid-message.error')).toContainText(
      'another bidder moved the minimum to $103',
    );
    await syncAuction(visibleWindows, auctionURL, deadlineMs, 'PROTECTED: one $102 accepted, one refreshed');

    await waitUntil(deadlineMs, 7);
    const chaosResults = await Promise.all([
      bid(bidderPages[0], '103.00', '🔥 CHAOS WAVE: $103'),
      bid(bidderPages[1], '106.00', '🔥 CHAOS WAVE: $106'),
      bid(bidderPages[2], '104.00', '🔥 CHAOS WAVE: $104'),
    ]);
    expect(chaosResults[1].kind).toBe('success');
    await syncAuction(visibleWindows, auctionURL, deadlineMs, 'PROTECTED: $106 leads; stale lower bids rejected');

    await waitUntil(deadlineMs, 1.7);
    const lastSecondResults = await Promise.all([
      bid(bidderPages[0], '107.00', '🚨 LAST-SECOND $107'),
      bid(bidderPages[1], '107.00', '🚨 LAST-SECOND $107'),
      bid(bidderPages[2], '107.00', '🚨 LAST-SECOND $107'),
    ]);
    expect(lastSecondResults.filter((result) => result.kind === 'success')).toHaveLength(1);
    expect(lastSecondResults.filter((result) => result.kind === 'error')).toHaveLength(2);

    await waitUntil(deadlineMs, -0.3);
    await Promise.all(bidderPages.map(async (page) => {
      await expect(page.locator('.ending strong')).toHaveText('Ended');
      await expect(page.getByRole('button', { name: 'Place bid' })).toBeDisabled();
      await expect(page.locator('.bid-guidance')).toHaveText('Bidding has ended.');
      await setStatus(page, '💥 TOO LATE: attempting $108 after close…');
      const result = await page.evaluate(async ({ auctionSlug, userId }) => {
        const response = await fetch(`/api/auctions/${auctionSlug}/bids`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId, amountCents: 10_800 }),
        });
        const body = await response.json() as { code?: string; error?: string };
        return { status: response.status, code: body.code, error: body.error };
      }, {
        auctionSlug: slug,
        userId: Number(await page.locator('#active-user').inputValue()),
      });
      expect(result).toMatchObject({
        status: 409,
        code: 'AUCTION_CLOSED',
        error: 'This auction has ended',
      });
      await setStatus(page, `⛔ $108 rejected: ${result.error}`);
    }));

    await sellerPage.reload();
    await sellerPage.getByRole('heading', { name: title }).waitFor();
    await decorate(sellerPage, seller, deadlineMs, 'PROTECTED — accepted bid history is strictly increasing');

    const duplicateResult = await database.query<{ amount_cents: number; accepted: number }>(
      `SELECT b.amount_cents, count(*)::int AS accepted
       FROM bids b JOIN auctions a ON a.id = b.auction_id
       WHERE a.slug = $1
       GROUP BY b.amount_cents
       HAVING count(*) > 1
       ORDER BY b.amount_cents`,
      [slug],
    );
    expect(duplicateResult.rows).toEqual([]);

    const historyResult = await database.query<{ amount_cents: number }>(
      `SELECT b.amount_cents
       FROM bids b JOIN auctions a ON a.id = b.auction_id
       WHERE a.slug = $1
       ORDER BY b.created_at ASC, b.id ASC`,
      [slug],
    );
    const acceptedAmounts = historyResult.rows.map((row) => row.amount_cents);
    expect(acceptedAmounts.at(-1)).toBe(10_700);
    expect(new Set(acceptedAmounts).size).toBe(acceptedAmounts.length);
    for (let index = 1; index < acceptedAmounts.length; index += 1) {
      expect(acceptedAmounts[index]).toBeGreaterThanOrEqual(acceptedAmounts[index - 1] + 100);
    }

    await database.query('DROP TRIGGER IF EXISTS bidding_war_delay_insert ON bids');
    await database.query('DROP FUNCTION IF EXISTS bidding_war_delay_insert()');
    triggerInstalled = false;

    await tileWindows(launched);
    await sellerPage.bringToFront();

    console.log('\n🏁 BIDDING WAR PROTECTED');
    console.log(`Auction: ${auctionURL}`);
    console.log('Accepted amounts:', acceptedAmounts);

    if (holdOpenMs > 0) {
      console.log(`Holding all four tiled Edge windows open for ${holdOpenMs}ms…`);
      await new Promise((resolve) => setTimeout(resolve, holdOpenMs));
    }
  } finally {
    if (triggerInstalled) {
      await database.query('DROP TRIGGER IF EXISTS bidding_war_delay_insert ON bids');
      await database.query('DROP FUNCTION IF EXISTS bidding_war_delay_insert()');
    }
    await database.end();
    await Promise.all(launched.map(({ context }) => context.close()));
    await browser.close();
  }
});
