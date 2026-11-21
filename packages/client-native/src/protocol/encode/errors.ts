import type { ColumnType } from "../types";

/** A `Variant` value: the index of the variant and the stored value. */
export interface VariantNorm {
  d: number;
  v: unknown;
}

/** A `Dynamic` value: the type of the value and the stored value. */
export interface DynamicNorm {
  t: ColumnType;
  v: unknown;
}

export class InsertValueError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, InsertValueError.prototype);
  }
}

/**
 * The server must parse a value using its JSON input rules. The connection
 * sends the rows as JSON text so those rules match the HTTP interface.
 */
export class ServerParseNeeded extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ServerParseNeeded.prototype);
  }
}

export interface EncodeContext {
  /** The time zone for `DateTime` columns without one. */
  timezone: string;
  /**
   * What to do with `null` for a type that is not `Nullable`. If this is not
   * `false`, the value becomes the default value of the type, as with the
   * server setting `input_format_null_as_default = 1`. If this is `false`,
   * the value is an error.
   * @default true
   */
  null_as_default?: boolean;
  /**
   * The server finds dates in the strings of a `Dynamic` column
   * (`input_format_try_infer_dates`, `input_format_try_infer_datetimes`). If
   * this is `true`, a string that can be a date throws
   * {@link ServerParseNeeded}. If not, each string is a `String`.
   * @default false
   */
  infer_dates?: boolean;
  /** Use the server's JSON parser for values whose handling varies by version. */
  fallback_for_version_specific_values?: boolean;
}

export function fail(type: ColumnType, value: unknown, reason?: string): never {
  let text: string;
  try {
    text = JSON.stringify(value, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  } catch {
    text = String(value);
  }
  if (text !== undefined && text.length > 100) text = text.slice(0, 100) + "…";
  throw new InsertValueError(
    `Cannot insert the value ${text} into a column of type ${type.name}` +
      (reason ? `: ${reason}` : ""),
  );
}
