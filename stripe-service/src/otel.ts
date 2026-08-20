import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ParentBasedSampler,
  SamplingDecision,
  type Sampler,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base';

class StripeRootSampler implements Sampler {
  shouldSample(
    _parentContext: Parameters<Sampler['shouldSample']>[0],
    _traceId: string,
    spanName: string,
  ): SamplingResult {
    return {
      decision: spanName.startsWith('mock-stripe.')
        ? SamplingDecision.RECORD_AND_SAMPLED
        : SamplingDecision.NOT_RECORD,
    };
  }

  toString(): string {
    return 'StripeRootSampler';
  }
}

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'mock-stripe',
  autoDetectResources: false,
  sampler: new ParentBasedSampler({ root: new StripeRootSampler() }),
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [new UndiciInstrumentation({
    requireParentforSpans: true,
    requestHook(span, request) {
      if (request.path === '/api/webhooks/stripe') {
        span.updateName('winner.purchase.webhook HTTP');
      }
    },
  })],
});

sdk.start();

process.once('SIGTERM', () => void sdk.shutdown());
process.once('SIGINT', () => void sdk.shutdown());
