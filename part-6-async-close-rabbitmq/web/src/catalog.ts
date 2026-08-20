export type ProductArtKind = 'gpu' | 'cpu' | 'memory' | 'chassis' | 'switch' | 'cooling';

export type DemoUser = {
  id: number;
  displayName: string;
  handle: string;
};

export type AuctionItem = {
  slug: string;
  title: string;
  kicker: string;
  category: string;
  art: ProductArtKind;
  currentPriceCents: number;
  bidCount: number;
  currentBidder: string | null;
  endsAt: string;
  closedAt: string | null;
  winningBid: Bid | null;
  seller: DemoUser;
  location: string;
  condition: string;
  description: string;
  specs: Array<[string, string]>;
  bidHistory?: Bid[];
};

export type Bid = {
  id: string;
  amountCents: number;
  createdAt: string;
  bidder: DemoUser;
};

export type CreateAuctionInput = {
  userId: number;
  title: string;
  category: string;
  description: string;
  condition: string;
  location: string;
  startingPriceCents: number;
  endsAt: string;
};

export type BidConflictCode = 'AUCTION_CLOSED' | 'BID_TOO_LOW' | 'SELLER_CANNOT_BID';

type BidConflictBody = {
  code: BidConflictCode;
  error: string;
  currentPriceCents: number;
  minimumBidCents: number;
  endsAt: string;
};

export class BidConflictError extends Error {
  constructor(
    message: string,
    readonly code: BidConflictCode,
    readonly currentPriceCents: number,
    readonly minimumBidCents: number,
    readonly endsAt: string,
  ) {
    super(message);
    this.name = 'BidConflictError';
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function fetchAuctions(query = ''): Promise<AuctionItem[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  return getJson(`/api/auctions${params.size ? `?${params.toString()}` : ''}`);
}

export function fetchAuction(slug: string): Promise<AuctionItem> {
  return getJson(`/api/auctions/${encodeURIComponent(slug)}`);
}

export function fetchUsers(): Promise<DemoUser[]> {
  return getJson('/api/users');
}

export async function createAuction(input: CreateAuctionInput): Promise<{ slug: string }> {
  const response = await fetch('/api/auctions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json() as { slug?: string; error?: string };
  if (!response.ok || !body.slug) throw new Error(body.error ?? `Request failed (${response.status})`);
  return { slug: body.slug };
}

export async function createBid(slug: string, input: { userId: number; amountCents: number }): Promise<Bid> {
  const response = await fetch(`/api/auctions/${encodeURIComponent(slug)}/bids`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json() as Bid & Partial<BidConflictBody>;
  if (!response.ok) {
    if (
      response.status === 409
      && body.code
      && typeof body.currentPriceCents === 'number'
      && typeof body.minimumBidCents === 'number'
      && typeof body.endsAt === 'string'
    ) {
      throw new BidConflictError(
        body.error ?? `Request failed (${response.status})`,
        body.code,
        body.currentPriceCents,
        body.minimumBidCents,
        body.endsAt,
      );
    }
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body;
}

export function parseDollarsToCents(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [dollars, fraction = ''] = normalized.split('.');
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatTimeLeft(endsAt: string, now = Date.now()): string {
  const remainingMinutes = Math.ceil((new Date(endsAt).getTime() - now) / 60_000);
  if (remainingMinutes <= 0) return 'Ended';
  const days = Math.floor(remainingMinutes / 1_440);
  const hours = Math.floor((remainingMinutes % 1_440) / 60);
  const minutes = remainingMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
