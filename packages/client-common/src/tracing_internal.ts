import type { LogWriter } from './logger'
import { ClickHouseLogLevel } from './logger'
import type {
  ClickHouseTracer,
  ClickHouseTracerSpanAttributes,
} from './tracing'

/**
 * Internal helper that wraps an async operation with optional tracer hook
 * calls. All tracer calls are guarded so that a misbehaving tracer cannot
 * break client operations - any thrown exception is caught and logged at
 * WARN level via the supplied {@link LogWriter}.
 *
 * Flow:
 *   1. {@link ClickHouseTracer.startSpan startSpan(spanName, initialAttributes)}
 *   2. Run `op(span)` (which may attach more attributes via {@link applyAttributes}).
 *   3. On success:
 *        a. If `attributesFromResult` is provided, the attributes it returns
 *           are passed to {@link ClickHouseTracer.setAttributes setAttributes}.
 *        b. {@link ClickHouseTracer.setStatus setStatus({ code: 'OK' })}
 *   4. On failure:
 *        a. {@link ClickHouseTracer.recordException recordException(error)}
 *        b. {@link ClickHouseTracer.setStatus setStatus({ code: 'ERROR', ... })}
 *   5. {@link ClickHouseTracer.endSpan endSpan} (always)
 *
 * If `tracer` is `undefined`, `op(undefined)` is called and the function
 * behaves as a transparent passthrough.
 */
export async function runWithTracer<T>(
  tracer: ClickHouseTracer<unknown> | undefined,
  log_writer: LogWriter,
  log_level: ClickHouseLogLevel,
  spanName: string,
  initialAttributes: ClickHouseTracerSpanAttributes,
  op: (span: unknown | undefined) => Promise<T>,
  attributesFromResult?: (
    result: T,
  ) => ClickHouseTracerSpanAttributes | undefined,
): Promise<T> {
  if (tracer === undefined) {
    return op(undefined)
  }
  let span: unknown
  try {
    span = tracer.startSpan(spanName, initialAttributes)
  } catch (err) {
    logTracerError(log_writer, log_level, 'startSpan', spanName, err)
    return op(undefined)
  }
  try {
    const result = await op(span)
    if (attributesFromResult !== undefined) {
      const extra = attributesFromResult(result)
      if (extra !== undefined) {
        applyAttributes(tracer, log_writer, log_level, spanName, span, extra)
      }
    }
    safeCallTracer(log_writer, log_level, 'setStatus', spanName, () =>
      tracer.setStatus(span, { code: 'OK' }),
    )
    return result
  } catch (err) {
    safeCallTracer(log_writer, log_level, 'recordException', spanName, () =>
      tracer.recordException(span, err),
    )
    safeCallTracer(log_writer, log_level, 'setStatus', spanName, () =>
      tracer.setStatus(span, {
        code: 'ERROR',
        message: err instanceof Error ? err.message : String(err),
      }),
    )
    throw err
  } finally {
    safeCallTracer(log_writer, log_level, 'endSpan', spanName, () =>
      tracer.endSpan(span),
    )
  }
}

/** Best-effort {@link ClickHouseTracer.setAttributes} call. */
export function applyAttributes(
  tracer: ClickHouseTracer<unknown>,
  log_writer: LogWriter,
  log_level: ClickHouseLogLevel,
  spanName: string,
  span: unknown,
  attributes: ClickHouseTracerSpanAttributes,
): void {
  safeCallTracer(log_writer, log_level, 'setAttributes', spanName, () =>
    tracer.setAttributes(span, attributes),
  )
}

function safeCallTracer(
  log_writer: LogWriter,
  log_level: ClickHouseLogLevel,
  hook: string,
  spanName: string,
  call: () => void,
): void {
  try {
    call()
  } catch (err) {
    logTracerError(log_writer, log_level, hook, spanName, err)
  }
}

function logTracerError(
  log_writer: LogWriter,
  log_level: ClickHouseLogLevel,
  hook: string,
  spanName: string,
  err: unknown,
): void {
  if (log_level <= ClickHouseLogLevel.WARN) {
    log_writer.warn({
      module: 'Client',
      message: `Tracer hook ${hook} for span "${spanName}" threw an error; ignoring.`,
      args: {
        error: err instanceof Error ? err.message : String(err),
      },
    })
  }
}
