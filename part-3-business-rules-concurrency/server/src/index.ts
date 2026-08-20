import './otel.js';

const { buildApp } = await import('./app.js');
const app = buildApp();
const port = Number(process.env.API_PORT ?? 3103);

try {
  await app.listen({ port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
