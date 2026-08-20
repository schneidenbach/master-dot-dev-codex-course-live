import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import Fastify from 'fastify';
import { z } from 'zod';

const createSessionSchema = z.object({
  mode: z.literal('payment'),
  client_reference_id: z.string().uuid(),
  line_items: z.array(z.object({
    price_data: z.object({
      currency: z.literal('usd'),
      product_data: z.object({ name: z.string().trim().min(1).max(160) }),
      unit_amount: z.number().int().positive().safe(),
    }),
    quantity: z.literal(1),
  })).length(1),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
});
const attemptSchema = z.object({
  cardNumber: z.string().transform((value) => value.replace(/\s/g, '')).pipe(z.string().regex(/^\d{16}$/)),
  expiry: z.string().regex(/^\d{2}\s*\/\s*\d{2}$/),
  cvc: z.string().regex(/^\d{3}$/),
});

type CheckoutSession = {
  id: string;
  object: 'checkout.session';
  url: string;
  status: 'open' | 'complete';
  payment_status: 'unpaid' | 'paid';
  client_reference_id: string;
  success_url: string;
  cancel_url: string;
  title: string;
  amount_cents: number;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}

function publicSession(session: CheckoutSession) {
  return {
    id: session.id,
    object: session.object,
    url: session.url,
    status: session.status,
    payment_status: session.payment_status,
    client_reference_id: session.client_reference_id,
  };
}

function checkoutHtml(session: CheckoutSession) {
  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(session.amount_cents / 100);
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkout · Mock Stripe</title><style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2937;background:#f6f7fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px}.shell{width:min(880px,100%);display:grid;grid-template-columns:1fr 1.15fr;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;box-shadow:0 24px 70px rgba(26,31,54,.12)}.summary{padding:44px;background:#f1f3f8}.brand{font-weight:750;color:#635bff;letter-spacing:-.02em}.summary h1{font-size:22px;margin:48px 0 8px;line-height:1.25}.amount{font-size:36px;font-weight:750;letter-spacing:-.04em;margin:0}.summary small{display:block;color:#6b7280;margin-top:10px}.form{padding:44px}.form h2{font-size:18px;margin:0 0 24px}label{display:block;font-size:13px;font-weight:650;margin:16px 0 7px}input{width:100%;height:43px;border:1px solid #cfd4dc;border-radius:7px;padding:0 12px;font:inherit;outline:none}input:focus{border-color:#635bff;box-shadow:0 0 0 3px rgba(99,91,255,.14)}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.test-card{font-size:12px;color:#667085;background:#f8f9fb;border:1px solid #eaecf0;padding:10px 12px;border-radius:7px;margin:16px 0}.error{min-height:20px;color:#b42318;font-size:13px;margin:10px 0}button,.cancel{display:flex;width:100%;height:44px;align-items:center;justify-content:center;border-radius:7px;font-weight:700;text-decoration:none}.pay{border:0;background:#635bff;color:white;cursor:pointer}.pay:disabled{opacity:.6}.cancel{color:#475467;margin-top:10px}.secure{font-size:12px;text-align:center;color:#98a2b3;margin:18px 0 0}@media(max-width:720px){.shell{grid-template-columns:1fr}.summary,.form{padding:28px}.summary h1{margin-top:28px}}
  </style></head><body><main class="shell"><section class="summary"><div class="brand">stripe<span style="color:#98a2b3"> test</span></div><h1>${escapeHtml(session.title)}</h1><p class="amount">${dollars}</p><small>Winning Bid · USD</small></section><section class="form"><h2>Pay with card</h2><form id="payment-form"><label for="card">Card number</label><input id="card" name="card" inputmode="numeric" autocomplete="cc-number" placeholder="1234 1234 1234 1234" required><div class="row"><div><label for="expiry">Expiration</label><input id="expiry" name="expiry" autocomplete="cc-exp" placeholder="MM / YY" required></div><div><label for="cvc">CVC</label><input id="cvc" name="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="CVC" required></div></div><p class="test-card">Decline test card: <strong>4000 0000 0000 0002</strong></p><p id="error" class="error" role="alert"></p><button class="pay" type="submit">Pay ${dollars}</button><a class="cancel" href="${escapeHtml(session.cancel_url)}">Cancel</a><p class="secure">Test checkout · card details are not stored</p></form></section></main><script>
    const form=document.querySelector('#payment-form');const error=document.querySelector('#error');form.addEventListener('submit',async(event)=>{event.preventDefault();error.textContent='';const button=form.querySelector('button');button.disabled=true;button.textContent='Processing…';const response=await fetch('/v1/checkout/sessions/${session.id}/attempt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cardNumber:form.card.value,expiry:form.expiry.value,cvc:form.cvc.value})});const body=await response.json();if(response.ok&&body.redirect_url){window.location.replace(body.redirect_url);return}error.textContent=body.error||'Payment could not be completed.';button.disabled=false;button.textContent='Pay ${dollars}';});
  </script></body></html>`;
}

export function buildStripeApp(options: {
  baseUrl?: string;
  logger?: boolean;
  webhookUrl?: string;
  webhookSecret?: string;
  deliverWebhook?: (body: string, signature: string) => Promise<boolean>;
} = {}) {
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:7107';
  const webhookUrl = options.webhookUrl ?? 'http://127.0.0.1:3107/api/webhooks/stripe';
  const webhookSecret = options.webhookSecret ?? 'whsec_local_part_7';
  const deliverWebhook = options.deliverWebhook ?? (async (body: string, signature: string) => {
    const response = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-stripe-signature': signature }, body });
    return response.ok;
  });
  const sessions = new Map<string, CheckoutSession>();
  const app = Fastify({ logger: options.logger ?? true });

  app.get('/health', async () => ({ ok: true, sessions: sessions.size }));

  app.post('/v1/checkout/sessions', async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { type: 'invalid_request_error', message: parsed.error.issues[0]?.message ?? 'Invalid Checkout Session.' } });
    const existing = [...sessions.values()].find((session) => session.client_reference_id === parsed.data.client_reference_id && session.status === 'open');
    if (existing) return publicSession(existing);
    const lineItem = parsed.data.line_items[0]!;
    const id = `cs_test_${randomBytes(12).toString('hex')}`;
    const session: CheckoutSession = {
      id,
      object: 'checkout.session',
      url: `${baseUrl}/checkout/${id}`,
      status: 'open',
      payment_status: 'unpaid',
      client_reference_id: parsed.data.client_reference_id,
      success_url: parsed.data.success_url,
      cancel_url: parsed.data.cancel_url,
      title: lineItem.price_data.product_data.name,
      amount_cents: lineItem.price_data.unit_amount,
    };
    sessions.set(id, session);
    return reply.code(201).send(publicSession(session));
  });

  app.get('/v1/checkout/sessions/:id', async (request, reply) => {
    const id = z.object({ id: z.string().startsWith('cs_') }).safeParse(request.params);
    const session = id.success ? sessions.get(id.data.id) : undefined;
    if (!session) return reply.code(404).send({ error: { type: 'invalid_request_error', message: 'No such Checkout Session.' } });
    return publicSession(session);
  });

  app.get('/checkout/:id', async (request, reply) => {
    const id = z.object({ id: z.string().startsWith('cs_') }).safeParse(request.params);
    const session = id.success ? sessions.get(id.data.id) : undefined;
    if (!session) return reply.code(404).type('text/html').send('<h1>Checkout Session not found</h1>');
    return reply.type('text/html; charset=utf-8').send(checkoutHtml(session));
  });

  app.post('/v1/checkout/sessions/:id/attempt', async (request, reply) => {
    const id = z.object({ id: z.string().startsWith('cs_') }).safeParse(request.params);
    const parsed = attemptSchema.safeParse(request.body);
    const session = id.success ? sessions.get(id.data.id) : undefined;
    if (!session) return reply.code(404).send({ error: 'Checkout Session not found.' });
    if (!parsed.success) return reply.code(400).send({ error: 'Enter valid test card details.' });
    if (parsed.data.cardNumber === '4000000000000002') return reply.code(402).send({ error: 'Your card was declined. Use a different card and try again.' });
    if (parsed.data.cardNumber === '4242424242424242') {
      const event = {
        eventId: randomUUID(),
        eventType: 'checkout.session.completed',
        occurredAt: new Date().toISOString(),
        data: { object: { id: session.id, object: session.object, status: 'complete', payment_status: 'paid', client_reference_id: session.client_reference_id, amount_total: session.amount_cents, currency: 'usd' } },
      };
      const body = JSON.stringify(event);
      const signature = createHmac('sha256', webhookSecret).update(body).digest('hex');
      if (!await deliverWebhook(body, signature)) return reply.code(502).send({ error: 'Payment confirmation could not reach Auction House. Try again.' });
      session.status = 'complete';
      session.payment_status = 'paid';
      return { redirect_url: session.success_url.replace('{CHECKOUT_SESSION_ID}', session.id) };
    }
    return reply.code(409).send({ error: 'This payment method is not available.' });
  });

  return app;
}
