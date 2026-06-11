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
 * {@link BaseClickHouseClientConfigOptions.tracer}, the client runs each
 * tracked operation (`query`, `command`, `exec`, `insert`, `ping`) inside
 * {@link ClickHouseTracer.startActiveSpan}, mutates the provided
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
  /**
   * Called when a tracked operation begins. Same shape as OpenTelemetry's
   * `Tracer.startActiveSpan(name, options, fn)` overload: implementations
   * must invoke `fn` with the new span and return `fn`'s result untouched.
   * The client runs the entire operation (an `async` function) inside `fn`,
   * mutates the span during the operation, and ends it exactly once.
   *
   * @note The callback is asynchronous under the hood: the client keeps using
   * the span across `await` points inside `fn`. For OpenTelemetry, active-span
   * context propagation across those `await`s requires the
   * `AsyncLocalStorageContextManager` (from
   * `@opentelemetry/context-async-hooks`) to be registered - which is the
   * default context manager in the OpenTelemetry Node.js SDK
   * (`@opentelemetry/sdk-node` / `NodeTracerProvider`). With it in place,
   * auto-instrumented child spans (e.g. from
   * `@opentelemetry/instrumentation-http`) are parented under the ClickHouse
   * operation span.
   */
  startActiveSpan<T>(
    name: string,
    options: ClickHouseSpanOptions,
    fn: (span: TSpan) => T,
  ): T;
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
/** Shared no-op span handed out by {@link NoopClickHouseTracer}. @internal */
export const NoopClickHouseSpan: ClickHouseSpan = {
  setAttributes: noop,
  setStatus: noop,
  recordException: noop,
  end: noop,
};

/** No-op tracer assigned once at client creation when no tracer is
 *  configured, so the hot path stays branch-free (monomorphic call sites
 *  that the JIT can inline). @internal */
export const NoopClickHouseTracer: ClickHouseTracer = {
  startActiveSpan: (_name, _options, fn) => fn(NoopClickHouseSpan),
};

/** Records the exception on the span and marks it with the ERROR status,
 *  normalizing non-`Error` throwables to `Error`. */
export function recordSpanError(span: ClickHouseSpan, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  span.recordException(error);
  span.setStatus({
    code: ClickHouseSpanStatusCode.ERROR,
    message: error.message,
  });
}
