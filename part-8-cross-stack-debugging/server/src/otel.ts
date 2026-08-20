import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ParentBasedSampler,
  SamplingDecision,
  type ReadableSpan,
  type Sampler,
  type SamplingResult,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';

const businessPrefixes = ['auction.', 'winner.', 'mock-stripe.'];

class BusinessRootSampler implements Sampler {
  shouldSample(
    _parentContext: Parameters<Sampler['shouldSample']>[0],
    _traceId: string,
    spanName: string,
  ): SamplingResult {
    return {
      decision: businessPrefixes.some((prefix) => spanName.startsWith(prefix))
        ? SamplingDecision.RECORD_AND_SAMPLED
        : SamplingDecision.NOT_RECORD,
    };
  }

  toString(): string {
    return 'BusinessRootSampler';
  }
}

const excludedAttributes = new Set([
  'db.statement',
  'db.query.text',
  'db.connection_string',
  'db.user',
  'http.request.body',
  'http.response.body',
  'http.url',
  'url.full',
]);

class RedactingExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: Parameters<SpanExporter['export']>[1]): void {
    const meaningful = spans.filter((span) => ![
      'pg.connect',
      'pg-pool.connect',
      'pg.query:BEGIN auction_part_8',
      'pg.query:COMMIT auction_part_8',
      'pg.query:ROLLBACK auction_part_8',
    ].includes(span.name));
    const redacted = meaningful.map((span) => new Proxy(span, {
      get(target, property, receiver) {
        if (property !== 'attributes') return Reflect.get(target, property, receiver) as unknown;
        return Object.fromEntries(
          Object.entries(target.attributes).filter(([name]) => !excludedAttributes.has(name)),
        );
      },
    }));
    this.delegate.export(redacted, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush?.() ?? Promise.resolve();
  }
}

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'auction-service',
  autoDetectResources: false,
  sampler: new ParentBasedSampler({ root: new BusinessRootSampler() }),
  traceExporter: new RedactingExporter(new OTLPTraceExporter()),
  instrumentations: [
    new PgInstrumentation({ enhancedDatabaseReporting: false }),
    new UndiciInstrumentation({
      requireParentforSpans: true,
      requestHook(span, request) {
        if (request.path.startsWith('/v1/checkout/sessions')) {
          span.updateName('mock-stripe.checkout HTTP');
        } else if (request.path === '/api/webhooks/stripe') {
          span.updateName('winner.purchase.webhook HTTP');
        }
      },
    }),
  ],
});

sdk.start();

async function shutdown() {
  await sdk.shutdown().catch(() => undefined);
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
