import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const checkoutSessionSchema = z.object({
  id: z.string().startsWith('cs_'),
  object: z.literal('checkout.session'),
  url: z.string().url(),
  status: z.enum(['open', 'complete']),
  payment_status: z.enum(['unpaid', 'paid']),
  client_reference_id: z.string().uuid(),
});

export const stripeWebhookEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal('checkout.session.completed'),
  occurredAt: z.string().datetime({ offset: true }),
  data: z.object({
    object: z.object({
      id: z.string().startsWith('cs_'),
      object: z.literal('checkout.session'),
      status: z.literal('complete'),
      payment_status: z.literal('paid'),
      client_reference_id: z.string().uuid(),
      amount_total: z.number().int().positive(),
      currency: z.literal('usd'),
    }),
  }),
});

export type StripeCheckoutInput = {
  purchaseId: string;
  title: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
};

export type StripeCheckoutSession = z.infer<typeof checkoutSessionSchema>;

export type StripeClient = {
  createCheckoutSession(input: StripeCheckoutInput): Promise<StripeCheckoutSession>;
  retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSession>;
};

export class StripeSessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Mock Stripe Session ${sessionId} was not found`);
    this.name = 'StripeSessionNotFoundError';
  }
}

export function createMockStripeClient(
  baseUrl = process.env.STRIPE_API_URL ?? 'http://127.0.0.1:7108',
): StripeClient {
  return {
    async createCheckoutSession(input) {
      const response = await fetch(`${baseUrl}/v1/checkout/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'payment',
          client_reference_id: input.purchaseId,
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: { name: input.title },
              unit_amount: input.amountCents,
            },
            quantity: 1,
          }],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Mock Stripe rejected Checkout Session (${response.status})`);
      return checkoutSessionSchema.parse(await response.json());
    },
    async retrieveCheckoutSession(sessionId) {
      const response = await fetch(`${baseUrl}/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 404) throw new StripeSessionNotFoundError(sessionId);
      if (!response.ok) throw new Error(`Mock Stripe retrieval failed (${response.status})`);
      return checkoutSessionSchema.parse(await response.json());
    },
  };
}

export function verifyStripeSignature(body: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
