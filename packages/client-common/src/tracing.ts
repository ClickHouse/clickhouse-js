/**
 * A minimal, dependency-free tracer interface that mirrors the
 * {@link https://opentelemetry.io/docs/specs/otel/trace/api/#span OpenTelemetry `Span` API}
 * shape, so it can be implemented as a trivial wrapper over a real OpenTelemetry
 * (or any other) tracer without forcing every user of `@clickhouse/client` to
 * pull in those dependencies.
 *
 * When a {@link ClickHouseTracer} is provided via
 * {@link BaseClickHouseClientConfigOptions.tracer}, the client will call
 * {@link ClickHouseTracer.startSpan} when a tracked operation begins
 * (e.g. `query`, `command`, `exec`, `insert`, `ping`), then
 * {@link ClickHouseTracer.setAttributes} / {@link ClickHouseTracer.setStatus} /
 * {@link ClickHouseTracer.recordException} during the operation, and finally
 * {@link ClickHouseTracer.endSpan} when it completes (regardless of outcome).
 *
 * The `TSpan` type parameter is opaque to the client - whatever object
 * {@link ClickHouseTracer.startSpan} returns is what the client will pass back
 * to the other hooks. This lets an OTEL adapter return an actual OTEL `Span`,
 * a Prometheus adapter return a timer handle, an `EventEmitter`-based adapter
 * return an event id, etc.
 *
 * Hook calls are inlined directly into the client's hot path - there is no
 * defensive wrapper around them. Any exception thrown by a hook will
 * propagate up to the caller of the corresponding client method
 * (`query`/`command`/`exec`/`insert`/`ping`). Implementations are therefore
 * expected to be non-throwing; a trivial e2e test against your tracer is
 * usually enough to catch regressions.
 */
export interface ClickHouseTracer<TSpan = unknown> {
  /** Called when a tracked operation begins.
   *  Returned value is passed back to the other hooks for this operation. */
  startSpan(name: string, attributes?: ClickHouseTracerSpanAttributes): TSpan;
  /** Attach additional attributes to an in-flight span. Called at least once
   *  for every span - typically right before {@link ClickHouseTracer.endSpan}
   *  - with operation-specific attributes such as `clickhouse.query_id`. */
  setAttributes(span: TSpan, attributes: ClickHouseTracerSpanAttributes): void;
  /** Set the OTEL-style logical status of the span. */
  setStatus(span: TSpan, status: ClickHouseTracerSpanStatus): void;
  /** Attach an exception that occurred during the span. Called before
   *  {@link ClickHouseTracer.setStatus} with code `ERROR`, before
   *  {@link ClickHouseTracer.endSpan}. */
  recordException(span: TSpan, error: unknown): void;
  /** Called exactly once per span, regardless of success or failure. */
  endSpan(span: TSpan): void;
}

/** OTEL-compatible span status. */
export type ClickHouseTracerSpanStatus =
  | { code: "UNSET" }
  | { code: "OK" }
  | { code: "ERROR"; message?: string };

/** Free-form attribute bag. Implementations should be tolerant of `undefined`
 *  values (skip them) and stringify non-primitive values as needed. */
export type ClickHouseTracerSpanAttributes = Record<
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
