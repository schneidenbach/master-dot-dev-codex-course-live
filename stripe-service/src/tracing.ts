import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';

const tracer = trace.getTracer('mock-stripe-business');

export function contextFromTraceparent(traceparent?: string): Context {
  return traceparent ? propagation.extract(ROOT_CONTEXT, { traceparent }) : ROOT_CONTEXT;
}

export function activeTraceparent(): string | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent ?? null;
}

export async function withStripeSpan<T>(
  name: string,
  attributes: Attributes,
  parent: Context,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, { attributes }, parent);
  return context.with(trace.setSpan(parent, span), async () => {
    try {
      return await work(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
