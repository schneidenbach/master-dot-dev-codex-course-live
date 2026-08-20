import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const app = buildApp();
const connectionString = process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_2';
const testTitle = 'Vitest liquid cooling manifold';

async function removeTestAuction() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('DELETE FROM auctions WHERE title = $1', [testTitle]);
  } finally {
    await client.end();
  }
}

beforeAll(removeTestAuction);
afterAll(async () => {
  await app.close();
  await removeTestAuction();
});

describe('marketplace read API', () => {
  it('reports a healthy database', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, db: 'ok' });
  });

  it('lists the ten seeded users', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/users' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(10);
    expect(response.json()[0]).toEqual({ id: 1, displayName: 'Avery Chen', handle: 'avery' });
  });

  it('lists all seeded auctions and searches the database-backed catalog', async () => {
    const allResponse = await app.inject({ method: 'GET', url: '/api/auctions' });
    expect(allResponse.statusCode).toBe(200);
    const slugs = allResponse.json().map((auction: { slug: string }) => auction.slug);
    expect(slugs).toEqual(expect.arrayContaining([
      'nvidia-h100-sxm-80gb',
      'amd-epyc-9654',
      'one-point-five-tb-ddr5-ecc',
      'supermicro-4u-gpu-chassis',
      'quantum-2-400g-switch',
      'direct-to-chip-cooling-loop',
    ]));

    const searchResponse = await app.inject({ method: 'GET', url: '/api/auctions?q=memory' });
    expect(searchResponse.statusCode).toBe(200);
    expect(searchResponse.json()).toHaveLength(1);
    expect(searchResponse.json()[0]).toMatchObject({
      slug: 'one-point-five-tb-ddr5-ecc',
      currentPriceCents: 689000,
      bidCount: 0,
    });
  });

  it('returns auction details by slug', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auctions/nvidia-h100-sxm-80gb',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      title: 'NVIDIA H100 SXM 80GB',
      seller: { id: 1, displayName: 'Avery Chen', handle: 'avery' },
    });
  });

  it('validates and persists a new auction for the active user', async () => {
    const invalidResponse = await app.inject({
      method: 'POST',
      url: '/api/auctions',
      payload: {
        userId: 10,
        title: testTitle,
        category: 'Cooling',
        description: 'A test listing that should be rejected because its closing time has passed.',
        condition: 'Bench tested',
        location: 'Madison, WI',
        startingPriceCents: 125000,
        endsAt: '2020-01-01T00:00:00.000Z',
      },
    });
    expect(invalidResponse.statusCode).toBe(400);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/auctions',
      payload: {
        userId: 10,
        title: testTitle,
        category: 'Cooling',
        description: 'A stainless distribution manifold tested under sustained pressure.',
        condition: 'Bench tested',
        location: 'Madison, WI',
        startingPriceCents: 125000,
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(createResponse.statusCode).toBe(201);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/auctions/${createResponse.json().slug}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      title: testTitle,
      art: 'cooling',
      currentPriceCents: 125000,
      seller: { id: 10, displayName: 'Marcus Green' },
      specs: [],
    });
  });
});
