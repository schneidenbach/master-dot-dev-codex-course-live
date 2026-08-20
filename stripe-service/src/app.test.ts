import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildStripeApp } from './app.js';

const app = buildStripeApp({ baseUrl: 'http://stripe.test', logger: false });

describe('mock Stripe Checkout', () => {
  it('creates and retrieves one recognizable open Session per Purchase', async () => {
    const purchaseId = crypto.randomUUID();
    const payload = {
      mode: 'payment',
      client_reference_id: purchaseId,
      line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Winning server' }, unit_amount: 12_500 }, quantity: 1 }],
      success_url: 'http://marketplace.test/items/server?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'http://marketplace.test/items/server?checkout=canceled',
    };
    const created = await app.inject({ method: 'POST', url: '/v1/checkout/sessions', payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      id: expect.stringMatching(/^cs_test_/),
      object: 'checkout.session',
      url: expect.stringMatching(/^http:\/\/stripe\.test\/checkout\/cs_test_/),
      status: 'open',
      payment_status: 'unpaid',
      client_reference_id: purchaseId,
    });

    const repeated = await app.inject({ method: 'POST', url: '/v1/checkout/sessions', payload });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().id).toBe(created.json().id);
    const retrieved = await app.inject({ method: 'GET', url: `/v1/checkout/sessions/${created.json().id}` });
    expect(retrieved.json()).toEqual(created.json());
  });

  it('hosts checkout, declines the decline card, and keeps the Session open', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/checkout/sessions',
      payload: {
        mode: 'payment',
        client_reference_id: crypto.randomUUID(),
        line_items: [{ price_data: { currency: 'usd', product_data: { name: '<script>unsafe</script>' }, unit_amount: 9_900 }, quantity: 1 }],
        success_url: 'http://marketplace.test/success',
        cancel_url: 'http://marketplace.test/cancel',
      },
    });
    const session = created.json();
    const hosted = await app.inject({ method: 'GET', url: `/checkout/${session.id}` });
    expect(hosted.statusCode).toBe(200);
    expect(hosted.headers['content-type']).toContain('text/html');
    expect(hosted.body).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(hosted.body).not.toContain('<script>unsafe</script>');

    const declined = await app.inject({ method: 'POST', url: `/v1/checkout/sessions/${session.id}/attempt`, payload: { cardNumber: '4000 0000 0000 0002', expiry: '12 / 30', cvc: '123' } });
    expect(declined.statusCode).toBe(402);
    expect(declined.json()).toMatchObject({ error: expect.stringContaining('declined') });
    const retrieved = await app.inject({ method: 'GET', url: `/v1/checkout/sessions/${session.id}` });
    expect(retrieved.json()).toMatchObject({ status: 'open', payment_status: 'unpaid' });
  });

  it('authenticates a successful completion before marking the Session paid and redirecting', async () => {
    const deliveries: Array<{ body: string; signature: string }> = [];
    const successApp = buildStripeApp({
      baseUrl: 'http://stripe.test',
      logger: false,
      webhookSecret: 'test_secret',
      deliverWebhook: async (body, signature) => {
        deliveries.push({ body, signature });
        return true;
      },
    });
    const purchaseId = crypto.randomUUID();
    const created = await successApp.inject({
      method: 'POST',
      url: '/v1/checkout/sessions',
      payload: {
        mode: 'payment',
        client_reference_id: purchaseId,
        line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Paid server' }, unit_amount: 20_000 }, quantity: 1 }],
        success_url: 'http://marketplace.test/items/server?checkout=success&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'http://marketplace.test/items/server?checkout=canceled',
      },
    });
    const session = created.json();
    const attempt = await successApp.inject({ method: 'POST', url: `/v1/checkout/sessions/${session.id}/attempt`, payload: { cardNumber: '4242 4242 4242 4242', expiry: '12 / 30', cvc: '123' } });
    expect(attempt.statusCode).toBe(200);
    expect(attempt.json()).toEqual({ redirect_url: `http://marketplace.test/items/server?checkout=success&session_id=${session.id}` });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.signature).toBe(createHmac('sha256', 'test_secret').update(deliveries[0]!.body).digest('hex'));
    expect(JSON.parse(deliveries[0]!.body)).toMatchObject({ eventType: 'checkout.session.completed', data: { object: { id: session.id, payment_status: 'paid', amount_total: 20_000 } } });
    const retrieved = await successApp.inject({ method: 'GET', url: `/v1/checkout/sessions/${session.id}` });
    expect(retrieved.json()).toMatchObject({ status: 'complete', payment_status: 'paid' });
    await successApp.close();
  });
});
