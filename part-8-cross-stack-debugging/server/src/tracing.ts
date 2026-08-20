import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';

const tracer = trace.getTracer('auction-business');

export function contextFromTraceparent(traceparent?: string | null): Context {
  return traceparent ? propagation.extract(ROOT_CONTEXT, { traceparent }) : ROOT_CONTEXT;
}

export function contextFromHeaders(headers: Record<string, unknown>): Context {
  const traceparent = headers.traceparent;
  const tracestate = headers.tracestate;
  return propagation.extract(ROOT_CONTEXT, {
    ...(typeof traceparent === 'string' ? { traceparent } : {}),
    ...(typeof tracestate === 'string' ? { tracestate } : {}),
  });
}

export function traceHeaders(source: Context = context.active()): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(source, carrier);
  return carrier;
}

export function activeTraceparent(): string | null {
  return traceHeaders().traceparent ?? null;
}

export function startBusinessSpan(
  name: string,
  attributes: Attributes,
  parent: Context = context.active(),
  kind: SpanKind = SpanKind.INTERNAL,
): { span: Span; activeContext: Context } {
  const span = tracer.startSpan(name, { attributes, kind }, parent);
  return { span, activeContext: trace.setSpan(parent, span) };
}

export async function withBusinessSpan<T>(
  name: string,
  attributes: Attributes,
  work: (span: Span) => Promise<T>,
  parent: Context = context.active(),
  kind: SpanKind = SpanKind.INTERNAL,
): Promise<T> {
  const { span, activeContext } = startBusinessSpan(name, attributes, parent, kind);
  return context.with(activeContext, async () => {
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
