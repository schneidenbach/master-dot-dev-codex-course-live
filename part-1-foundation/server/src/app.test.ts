import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const app = buildApp();
afterAll(() => app.close());

describe('GET /api/health', () => {
  it('reports a healthy database', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, db: 'ok' });
  });
});
