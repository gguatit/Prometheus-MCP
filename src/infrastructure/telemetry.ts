import type {
  TelemetrySpan,
  TelemetryEvent,
  MetricSample,
  CostRecord,
  SpanKind,
  SpanStatus,
} from "../types/index.js";

/**
 * TelemetrySink — the single observation surface. Every module emits through a
 * sink; no scattered console.log. MVP sinks: ConsoleJsonSink, CompositeSink,
 * NoopSink. Roadmap: OtlpSink. Secrets are redacted by wrapping sinks in
 * SecretRedactor.
 */

export interface TelemetrySink {
  logEvent(span: TelemetrySpan, event: TelemetryEvent): void;
  startSpan(span: TelemetrySpan): void;
  endSpan(span: TelemetrySpan): void;
  metric(sample: MetricSample): void;
  cost(record: CostRecord): void;
}

export class NoopSink implements TelemetrySink {
  logEvent(): void {}
  startSpan(): void {}
  endSpan(): void {}
  metric(): void {}
  cost(): void {}
}

export class ConsoleJsonSink implements TelemetrySink {
  constructor(private readonly out: (line: string) => void = (l) => process.stderr.write(l + "\n")) {}

  logEvent(span: TelemetrySpan, event: TelemetryEvent): void {
    this.out(JSON.stringify({ ts: "event", trace: span.traceId, span: span.spanId, ...event }));
  }
  startSpan(span: TelemetrySpan): void {
    this.out(JSON.stringify({ ts: "span.start", ...span }));
  }
  endSpan(span: TelemetrySpan): void {
    this.out(JSON.stringify({ ts: "span.end", ...span }));
  }
  metric(sample: MetricSample): void {
    this.out(JSON.stringify({ ts: "metric", ...sample }));
  }
  cost(record: CostRecord): void {
    this.out(JSON.stringify({ ts: "cost", ...record }));
  }
}

export class CompositeSink implements TelemetrySink {
  constructor(private readonly sinks: TelemetrySink[]) {}
  logEvent(span: TelemetrySpan, event: TelemetryEvent): void {
    for (const s of this.sinks) s.logEvent(span, event);
  }
  startSpan(span: TelemetrySpan): void {
    for (const s of this.sinks) s.startSpan(span);
  }
  endSpan(span: TelemetrySpan): void {
    for (const s of this.sinks) s.endSpan(span);
  }
  metric(sample: MetricSample): void {
    for (const s of this.sinks) s.metric(sample);
  }
  cost(record: CostRecord): void {
    for (const s of this.sinks) s.cost(record);
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_\-]{16,}/g, // openai-style
  /sk-ant-[A-Za-z0-9_\-]{16,}/g, // anthropic-style
  /[Aa]uthorization:\s*Bearer\s+[A-Za-z0-9_\-\.]+/g,
  /api[_-]?key["'\s:=]+[A-Za-z0-9_\-]{16,}/g,
  /[A-Za-z0-9_\-]{32,}/g, // generic long token heuristic
];

/**
 * Wraps a sink and redacts secret-like substrings from span/event/metric
 * string attributes. Numeric/boolean values pass through unchanged.
 */
export class SecretRedactor implements TelemetrySink {
  constructor(private readonly inner: TelemetrySink) {}

  private redact(value: string | number | boolean): string | number | boolean {
    if (typeof value !== "string") return value;
    let v = value;
    for (const p of SECRET_PATTERNS) v = v.replace(p, "[REDACTED]");
    return v;
  }

  private redactAttrs(attrs?: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
    if (!attrs) return {};
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(attrs)) out[k] = this.redact(v);
    return out;
  }

  logEvent(span: TelemetrySpan, event: TelemetryEvent): void {
    this.inner.logEvent(span, { ...event, attributes: this.redactAttrs(event.attributes) });
  }
  startSpan(span: TelemetrySpan): void {
    this.inner.startSpan({ ...span, attributes: this.redactAttrs(span.attributes) });
  }
  endSpan(span: TelemetrySpan): void {
    this.inner.endSpan({ ...span, attributes: this.redactAttrs(span.attributes) });
  }
  metric(sample: MetricSample): void {
    this.inner.metric({ ...sample, attributes: this.redactAttrs(sample.attributes) });
  }
  cost(record: CostRecord): void {
    this.inner.cost(record);
  }
}

/**
 * Tracer — ergonomic span creation with automatic end + status on dispose.
 * Usage: `const span = tracer.start("critic.run", { sessionId }); try { ... } finally { span.end(); }`
 */
export class Tracer {
  private spanCounter = 0;

  constructor(
    private readonly sink: TelemetrySink,
    private readonly traceId: string = randomId("trace"),
  ) {}

  start(
    name: string,
    attributes: Record<string, string | number | boolean> = {},
    kind: SpanKind = "internal",
    parentSpanId?: string,
  ): ActiveSpan {
    const spanId = randomId("span");
    const span: TelemetrySpan = {
      traceId: this.traceId,
      spanId,
      parentSpanId,
      name,
      kind,
      startMs: Date.now(),
      status: "ok",
      attributes,
      events: [],
    };
    this.sink.startSpan(span);
    return new ActiveSpan(this.sink, span);
  }

  metric(name: string, value: number, attributes?: Record<string, string | number | boolean>): void {
    this.sink.metric({ name, value, atMs: Date.now(), attributes });
  }

  cost(record: Omit<CostRecord, "atMs">): void {
    this.sink.cost({ ...record, atMs: Date.now() });
  }
}

export class ActiveSpan {
  private ended = false;
  private events: TelemetryEvent[] = [];

  constructor(
    private readonly sink: TelemetrySink,
    private readonly span: TelemetrySpan,
  ) {}

  event(name: string, attributes?: Record<string, string | number | boolean>): void {
    const ev: TelemetryEvent = { name, atMs: Date.now(), attributes };
    this.events.push(ev);
    this.sink.logEvent(this.span, ev);
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.span.attributes[key] = value;
  }

  end(status: SpanStatus = "ok"): void {
    if (this.ended) return;
    this.ended = true;
    this.span.endMs = Date.now();
    this.span.status = status;
    this.span.events = this.events;
    this.sink.endSpan(this.span);
  }

  get spanId(): string {
    return this.span.spanId;
  }
}

let counter = 0;
function randomId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newId(prefix: string): string {
  return randomId(prefix);
}
