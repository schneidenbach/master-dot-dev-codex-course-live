import { buildStripeApp } from './app.js';

const port = Number(process.env.STRIPE_PORT ?? 7107);
const app = buildStripeApp({
  baseUrl: process.env.STRIPE_PUBLIC_URL ?? `http://127.0.0.1:${port}`,
  webhookUrl: process.env.AUCTION_WEBHOOK_URL ?? 'http://127.0.0.1:3107/api/webhooks/stripe',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_local_part_7',
});

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
