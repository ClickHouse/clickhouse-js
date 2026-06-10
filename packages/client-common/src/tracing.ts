/**
 * A minimal, dependency-free tracer interface that is a structural subset of
 * the {@link https://opentelemetry.io/docs/specs/otel/trace/api/#tracer OpenTelemetry `Tracer` API}.
 *
 * The shapes below are deliberately declared so that a raw OpenTelemetry
 * tracer (the object returned by `trace.getTracer(...)` from
 * `@opentelemetry/api`) is assignable to {@link ClickHouseTracer} **as-is**,
 * with no adapter and no casts:
 *
 * ```ts
 * import { trace } from '@opentelemetry/api'
 * const client = createClient({ tracer: trace.getTracer('clickhouse-js') })
 * ```
 *
 * At the same time, the client itself imports nothing from OpenTelemetry -
 * non-OTEL backends (Prometheus counters, an `EventEmitter`, a plain logger)
 * can implement the same small surface directly.
 *
 * When a {@link ClickHouseTracer} is provided via
 * {@link BaseClickHouseClientConfigOptions.tracer}, the client calls
 * {@link ClickHouseTracer.startSpan} when a tracked operation begins
 * (`query`, `command`, `exec`, `insert`, `ping`), then mutates the returned
 * {@link ClickHouseSpan} during the operation
 * ({@link ClickHouseSpan.setAttributes}, {@link ClickHouseSpan.setStatus},
 * {@link ClickHouseSpan.recordException}), and finally calls
 * {@link ClickHouseSpan.end} when it completes (regardless of outcome).
 *
 * Calls are inlined directly into the client's hot path - there is no
 * defensive wrapper around them. Any exception thrown by a tracer or span
 * method will propagate up to the caller of the corresponding client method
 * (`query`/`command`/`exec`/`insert`/`ping`). Implementations are therefore
 * expected to be non-throwing; a trivial e2e test against your tracer is
 * usually enough to catch regressions.
 */
export interface ClickHouseTracer<
  TSpan extends ClickHouseSpan = ClickHouseSpan,
> {
  /** Called when a tracked operation begins. Same shape as the first two
   *  parameters of OpenTelemetry's `Tracer.startSpan`. The returned span is
   *  mutated by the client and ended exactly once. */
  startSpan(name: string, options?: ClickHouseSpanOptions): TSpan;
  /**
   * Optional. When defined, the client runs the underlying network operation
   * inside this scope function, so an OTEL implementation can make `span`
   * the _active_ span for the duration of `fn` - causing auto-instrumented
   * child spans (e.g. from `@opentelemetry/instrumentation-http`) to be
   * parented under the ClickHouse operation span.
   *
   * The function is synchronous: `fn` returns the operation's `Promise`, and
   * implementations must return `fn()`'s result untouched. An OTEL adapter is
   * a one-liner:
   *
   * ```ts
   * withActiveSpan: (span, fn) =>
   *   context.with(trace.setSpan(context.active(), span), fn)
   * ```
   *
   * When omitted, spans are still emitted, just never set as active.
   */
  withActiveSpan?<T>(span: TSpan, fn: () => T): T;
}

/** Structural subset of the OpenTelemetry `Span` interface - a real OTEL
 *  `Span` is assignable to this type as-is. Methods are declared as
 *  `void`-returning, so OTEL's chainable `this`-returning methods remain
 *  compatible. */
export interface ClickHouseSpan {
  /** Attach additional attributes to an in-flight span. Called at least once
   *  for every span - typically right before {@link ClickHouseSpan.end} -
   *  with operation-specific attributes such as `clickhouse.query_id`. */
  setAttributes(attributes: ClickHouseSpanAttributes): void;
  /** Set the logical status of the span. The codes are value-identical to
   *  OTEL's `SpanStatusCode`; see {@link ClickHouseSpanStatusCode}. */
  setStatus(status: ClickHouseSpanStatus): void;
  /** Attach an exception that occurred during the span. Called before
   *  {@link ClickHouseSpan.setStatus} with the `ERROR` code, before
   *  {@link ClickHouseSpan.end}. Non-`Error` throwables are normalized
   *  to `Error` by the client before this call. */
  recordException(error: Error): void;
  /** Called exactly once per span, regardless of success or failure. */
  end(): void;
}

/** Structural subset of OTEL's `SpanOptions`. */
export interface ClickHouseSpanOptions {
  /** Value-identical to OTEL's `SpanKind`; see {@link ClickHouseSpanKind}.
   *  The client always passes {@link ClickHouseSpanKind.CLIENT}, per the
   *  OTEL database semantic conventions. */
  kind?: number;
  /** Initial attributes for the span. */
  attributes?: ClickHouseSpanAttributes;
}

/** Span status; `code` values are listed in {@link ClickHouseSpanStatusCode}
 *  and are value-identical to OTEL's `SpanStatusCode`. */
export interface ClickHouseSpanStatus {
  code: number;
  message?: string;
}

/** Value-identical to OTEL's `SpanStatusCode`, so non-OTEL implementations
 *  do not have to deal with magic numbers. */
export const ClickHouseSpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

/** Value-identical to OTEL's `SpanKind`. The client only ever uses
 *  {@link ClickHouseSpanKind.CLIENT}. */
export const ClickHouseSpanKind = {
  INTERNAL: 0,
  SERVER: 1,
  CLIENT: 2,
  PRODUCER: 3,
  CONSUMER: 4,
} as const;

/** Free-form attribute bag; a subset of OTEL's `Attributes`. Implementations
 *  should be tolerant of `undefined` values (skip them) and stringify
 *  non-primitive values as needed. */
export type ClickHouseSpanAttributes = Record<
  string,
  string | number | boolean | undefined
>;

/** Span name constants used by the client when starting spans.
 *  Exposed so that adapters and tests can match on them. */
export const ClickHouseSpanNames = {
  query: "clickhouse.query",
  command: "clickhouse.command",
  exec: "clickhouse.exec",
  insert: "clickhouse.insert",
  ping: "clickhouse.ping",
} as const;
export type ClickHouseSpanName =
  (typeof ClickHouseSpanNames)[keyof typeof ClickHouseSpanNames];

const noop = (): void => undefined;
/** Shared no-op span used by the client when no tracer is configured,
 *  keeping the hot path free of conditional checks. @internal */
export const NoopClickHouseSpan: ClickHouseSpan = {
  setAttributes: noop,
  setStatus: noop,
  recordException: noop,
  end: noop,
};
