import type { DataFormat } from "./common/index";
import { BinaryJSONRows } from "./json_rows";
import type { Block, Column, Progress } from "./protocol/packets";
import type { ColumnType } from "./protocol/types";
import type {
  DecimalValue,
  JSONColumnarBlock,
  JSONObjectValue,
} from "./protocol/columns";
import { RawJSONValue, TypedValue, encodeText } from "./protocol/columns";
import type { DateTimeOutputFormat } from "./protocol/text";
import { formatDecimal } from "./protocol/text";

/**
 * The server sends the result of a query in `Native` blocks. The HTTP
 * interface returns the result in a text format, for example `JSONEachRow`.
 * {@link OutputEncoder} writes the decoded blocks in the format that the
 * caller asked for, so the result set and the code of the caller do not
 * change.
 *
 * The output follows the output settings of the server (for example
 * `output_format_json_quote_64bit_integers`), see {@link OutputSettings}.
 */
export const SupportedNativeFormats = [
  "JSON",
  "JSONStrings",
  "JSONCompact",
  "JSONCompactStrings",
  "JSONColumnsWithMetadata",
  "JSONObjectEachRow",
  "JSONEachRow",
  "JSONStringsEachRow",
  "JSONCompactEachRow",
  "JSONCompactStringsEachRow",
  "JSONCompactEachRowWithNames",
  "JSONCompactEachRowWithNamesAndTypes",
  "JSONCompactStringsEachRowWithNames",
  "JSONCompactStringsEachRowWithNamesAndTypes",
  "JSONEachRowWithProgress",
  "CSV",
  "CSVWithNames",
  "CSVWithNamesAndTypes",
  "TabSeparated",
  "TabSeparatedRaw",
  "TabSeparatedWithNames",
  "TabSeparatedWithNamesAndTypes",
] as const satisfies readonly DataFormat[];

export function isSupportedNativeFormat(format: string): boolean {
  return (SupportedNativeFormats as readonly string[]).includes(format);
}

/** The server settings that change the text of the values. The client reads
 *  them from the server (see `system.settings`) and from the settings of the
 *  query, because their defaults depend on the server version. */
export interface OutputSettings {
  output_format_json_quote_64bit_integers: boolean;
  output_format_json_quote_64bit_floats: boolean;
  output_format_json_quote_decimals: boolean;
  output_format_json_quote_denormals: boolean;
  output_format_json_escape_forward_slashes: boolean;
  output_format_json_named_tuples_as_objects: boolean;
  output_format_json_skip_null_value_in_named_tuples: boolean;
  output_format_json_map_as_array_of_tuples: boolean;
  /** The `JSON` format writes nested values on more than one line. */
  output_format_json_pretty_print: boolean;
  /** `JSONEachRow` and `JSONStringsEachRow` write one JSON array of rows. */
  output_format_json_array_of_rows: boolean;
  /** Replace bytes that are not UTF-8 with U+FFFD in the JSON formats. The
   *  formats that write one JSON document always do this. */
  output_format_json_validate_utf8: boolean;
  /** The formats that write one JSON document show the statistics. */
  output_format_write_statistics: boolean;
  output_format_decimal_trailing_zeros: boolean;
  output_format_csv_crlf_end_of_line: boolean;
  output_format_tsv_crlf_end_of_line: boolean;
  output_format_csv_serialize_tuple_into_separate_columns: boolean;
  output_format_csv_header_serialize_tuple_into_separate_columns: boolean;
  format_csv_delimiter: string;
  format_csv_null_representation: string;
  format_tsv_null_representation: string;
  format_json_object_each_row_column_for_object_name: string;
  bool_true_representation: string;
  bool_false_representation: string;
  /** The text of `DateTime` and `DateTime64` values. The decoder of the
   *  columns uses it (see `formatDateTime`). */
  date_time_output_format: DateTimeOutputFormat;
  /** `DateTime64` text without zeros at the end of the fraction, with 3, 6
   *  or 9 digits (the `simple` text only). The decoder of the columns uses
   *  it (see `formatDateTime64`). */
  date_time_64_output_format_cut_trailing_zeros_align_to_groups_of_thousands: boolean;
  /** The text of the `Interval*` values: `numeric` or `kusto`. */
  interval_output_format: string;
}

/** The defaults of a recent server. The client uses these when it cannot
 *  read the settings from the server. */
export const DefaultOutputSettings: OutputSettings = {
  output_format_json_quote_64bit_integers: false,
  output_format_json_quote_64bit_floats: false,
  output_format_json_quote_decimals: false,
  output_format_json_quote_denormals: false,
  output_format_json_escape_forward_slashes: true,
  output_format_json_named_tuples_as_objects: true,
  output_format_json_skip_null_value_in_named_tuples: false,
  output_format_json_map_as_array_of_tuples: false,
  output_format_json_pretty_print: true,
  output_format_json_array_of_rows: false,
  output_format_json_validate_utf8: false,
  output_format_write_statistics: true,
  output_format_decimal_trailing_zeros: false,
  output_format_csv_crlf_end_of_line: false,
  output_format_tsv_crlf_end_of_line: false,
  output_format_csv_serialize_tuple_into_separate_columns: true,
  output_format_csv_header_serialize_tuple_into_separate_columns: true,
  format_csv_delimiter: ",",
  format_csv_null_representation: "\\N",
  format_tsv_null_representation: "\\N",
  format_json_object_each_row_column_for_object_name: "",
  bool_true_representation: "true",
  bool_false_representation: "false",
  date_time_output_format: "simple",
  date_time_64_output_format_cut_trailing_zeros_align_to_groups_of_thousands: false,
  interval_output_format: "numeric",
};

export const OutputSettingNames = Object.keys(DefaultOutputSettings) as Array<
  keyof OutputSettings
>;

/** Applies setting values (as strings) to the output settings. */
export function applyOutputSettings(
  base: OutputSettings,
  values: Record<string, unknown>,
): OutputSettings {
  const result: OutputSettings = { ...base };
  const target = result as unknown as Record<string, unknown>;
  for (const name of OutputSettingNames) {
    const value = values[name];
    if (value === undefined || value === null) continue;
    if (typeof DefaultOutputSettings[name] === "boolean") {
      const s = String(value).toLowerCase();
      target[name] = s === "1" || s === "true";
    } else {
      target[name] = String(value);
    }
  }
  return result;
}

/**
 * Reads the settings of the `SETTINGS` clause of a statement, for example
 * `SELECT 1 SETTINGS output_format_json_quote_64bit_integers = 1 FORMAT JSON`.
 * The HTTP interface applies these settings to the output. The server does
 * not tell the client their values, so the client reads them from the SQL.
 *
 * The function uses the last `SETTINGS` clause that is not in parentheses.
 * It skips string literals, quoted identifiers and comments. It returns the
 * values as text, without quotes.
 */
export function settingsFromQuery(query: string): Record<string, string> {
  return readQueryClauses(query).settings;
}

/** Reads the top-level output clauses of a SQL statement. */
export function readQueryClauses(query: string): {
  settings: Record<string, string>;
  format: string | undefined;
} {
  const clauses = queryClausePositions(query);
  const parsed =
    clauses.settings < 0 ? undefined : readSettings(query, clauses.settings);
  const settings = parsed?.values ?? {};
  const name =
    clauses.format < 0
      ? undefined
      : readName(query, skipSpace(query, clauses.format));
  if (name === undefined) return { settings, format: undefined };
  let tail = skipSpace(query, name.end);
  if (
    parsed !== undefined &&
    tail === clauses.settings - "SETTINGS".length &&
    Object.keys(settings).length > 0
  ) {
    tail = parsed.end;
  }
  if (query[tail] === ";") tail = skipSpace(query, tail + 1);
  return { settings, format: tail === query.length ? name.text : undefined };
}

function readSettings(
  query: string,
  start: number,
): { values: Record<string, string>; end: number } {
  const result: Record<string, string> = {};
  let pos = start;
  for (;;) {
    pos = skipSpace(query, pos);
    const name = readName(query, pos);
    if (name === undefined) break;
    pos = skipSpace(query, name.end);
    if (query[pos] !== "=") break;
    pos = skipSpace(query, pos + 1);
    const value = readSettingValue(query, pos);
    if (value === undefined) break;
    result[name.text] = value.text;
    pos = skipSpace(query, value.end);
    if (query[pos] !== ",") break;
    pos++;
  }
  return { values: result, end: pos };
}

const WORD_CHAR = /[A-Za-z0-9_$]/;
const EXPECTS_EXPRESSION = new Set([
  "SELECT",
  "DISTINCT",
  "AS",
  "FROM",
  "JOIN",
  "WHERE",
  "PREWHERE",
  "HAVING",
  "BY",
  "ON",
  "AND",
  "OR",
  "NOT",
  "LIMIT",
  "OFFSET",
  "INTO",
  "WITH",
  "UNION",
]);

/** The positions after the top-level clause keywords, or -1. */
function queryClausePositions(query: string): {
  settings: number;
  format: number;
} {
  let depth = 0;
  let settings = -1;
  let format = -1;
  let afterExpression = false;
  let pos = 0;
  while (pos < query.length) {
    const c = query[pos] as string;
    const skipped = skipQuotedOrComment(query, pos);
    if (skipped !== pos) {
      if (depth === 0 && (c === "'" || c === '"' || c === "`" || c === "$")) {
        afterExpression = true;
      }
      pos = skipped;
    } else if (c === "(" || c === "[" || c === "{") {
      depth++;
      pos++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) afterExpression = true;
      pos++;
    } else if (WORD_CHAR.test(c)) {
      let end = pos + 1;
      while (end < query.length && WORD_CHAR.test(query[end] as string)) end++;
      if (depth === 0) {
        const word = query.slice(pos, end).toUpperCase();
        if (word === "SETTINGS") settings = end;
        if (word === "FORMAT" && afterExpression) format = end;
        afterExpression = !EXPECTS_EXPRESSION.has(word);
      }
      pos = end;
    } else {
      if (depth === 0 && c === ";") break;
      if (depth === 0 && !/\s/.test(c)) afterExpression = c === "*";
      pos++;
    }
  }
  return { settings, format };
}

/** If a string literal, a quoted identifier or a comment starts at `pos`,
 *  returns the position after it. If not, returns `pos`. */
function skipQuotedOrComment(query: string, pos: number): number {
  const c = query[pos];
  const next = query[pos + 1];
  if (c === "'" || c === '"' || c === "`") {
    return skipQuoted(query, pos);
  }
  if (c === "$") {
    const delimiter = /^\$[A-Za-z0-9_]*\$/.exec(query.slice(pos))?.[0];
    if (delimiter !== undefined) {
      const end = query.indexOf(delimiter, pos + delimiter.length);
      return end < 0 ? query.length : end + delimiter.length;
    }
  }
  if (
    (c === "-" && next === "-") ||
    (c === "#" && (next === " " || next === "!"))
  ) {
    const end = query.indexOf("\n", pos);
    return end < 0 ? query.length : end + 1;
  }
  if (c === "/" && next === "*") {
    let depth = 1;
    let end = pos + 2;
    while (end < query.length && depth > 0) {
      if (query.startsWith("/*", end)) {
        depth++;
        end += 2;
      } else if (query.startsWith("*/", end)) {
        depth--;
        end += 2;
      } else {
        end++;
      }
    }
    return end;
  }
  return pos;
}

/** Returns the position after the quoted text that starts at `pos`. A quote
 *  in the text has a backslash before it, or it is written two times. */
function skipQuoted(query: string, pos: number): number {
  const quote = query[pos];
  let i = pos + 1;
  while (i < query.length) {
    const c = query[i];
    if (c === "\\") {
      i += 2;
    } else if (c === quote) {
      if (query[i + 1] !== quote) return i + 1;
      i += 2;
    } else {
      i++;
    }
  }
  return query.length;
}

function skipSpace(query: string, pos: number): number {
  let i = pos;
  for (;;) {
    while (i < query.length && /\s/.test(query[i] as string)) i++;
    const c = query[i];
    if (c !== "-" && c !== "#" && c !== "/") return i;
    const skipped = skipQuotedOrComment(query, i);
    if (skipped === i) return i;
    i = skipped;
  }
}

interface Token {
  text: string;
  end: number;
}

function readName(query: string, pos: number): Token | undefined {
  const c = query[pos];
  if (c === "`" || c === '"') {
    const end = skipQuoted(query, pos);
    return { text: unquote(query.slice(pos, end)), end };
  }
  let end = pos;
  while (end < query.length && /[A-Za-z0-9_.]/.test(query[end] as string)) {
    end++;
  }
  return end === pos ? undefined : { text: query.slice(pos, end), end };
}

function readSettingValue(query: string, pos: number): Token | undefined {
  if (query[pos] === "'") {
    const end = skipQuoted(query, pos);
    return { text: unquote(query.slice(pos, end)), end };
  }
  let end = pos;
  while (end < query.length && /[^\s,;()]/.test(query[end] as string)) end++;
  return end === pos ? undefined : { text: query.slice(pos, end), end };
}

const UNESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "0": "\0",
  b: "\b",
  f: "\f",
};

/** Removes the quotes of a quoted text and decodes its escapes. */
function unquote(text: string): string {
  const quote = text[0] as string;
  const last =
    text.length > 1 && text.endsWith(quote) ? text.length - 1 : text.length;
  let out = "";
  for (let i = 1; i < last; i++) {
    const c = text[i] as string;
    if (c === "\\" && i + 1 < last) {
      const escaped = text[++i] as string;
      out += UNESCAPES[escaped] ?? escaped;
    } else if (c === quote && text[i + 1] === quote && i + 1 < last) {
      out += quote;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

/** Query statistics for the formats that show them. */
export interface OutputStatistics {
  elapsed_ns: number | bigint;
  rows_read: number | bigint;
  bytes_read: number | bigint;
  rows_before_limit_at_least: number | bigint | undefined;
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

/**
 * The decoder keeps the bytes of a `String` that are not UTF-8 as lone low
 * surrogates (U+DC80 to U+DCFF, one for each byte). The connection changes
 * them back to bytes after the text is written. Thus the writers in this
 * file must not change these characters, and `JSON.stringify` is not used
 * for strings (it writes a lone surrogate as `\udc80`).
 */
const LONE_SURROGATE_TEST = /[\udc80-\udcff]/;
/** One or more lone low surrogates: bytes that are not UTF-8. A low
 *  surrogate after a high surrogate is a part of a valid character. */
const LONE_SURROGATES = /(?<![\ud800-\udbff])[\udc80-\udcff]+/g;

/** Replaces each sequence of bytes that are not UTF-8 with U+FFFD, as the
 *  server does when it validates UTF-8. */
function replaceInvalidUTF8(s: string): string {
  return LONE_SURROGATE_TEST.test(s) ? s.replace(LONE_SURROGATES, "\ufffd") : s;
}

/* eslint-disable no-control-regex -- the JSON escapes */
const JSON_ESCAPE_TEST = /["\\\u0000-\u001f\u2028\u2029\udc80-\udcff]/;
const JSON_ESCAPE_TEST_SLASH = /["\\/\u0000-\u001f\u2028\u2029\udc80-\udcff]/;
const JSON_ESCAPE = /["\\\u0000-\u001f\u2028\u2029]/g;
const JSON_ESCAPE_SLASH = /["\\/\u0000-\u001f\u2028\u2029]/g;
/* eslint-enable no-control-regex */

/** The JSON escapes of the server: short escapes where JSON has them, and
 *  `\uXXXX` with upper-case digits for the other control characters. */
const JSON_ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "/": "\\/",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};
for (let code = 0; code < 0x20; code++) {
  const c = String.fromCharCode(code);
  JSON_ESCAPES[c] ??= "\\u" + code.toString(16).toUpperCase().padStart(4, "0");
}

const JSON_ESCAPE_BYTES = Array.from({ length: 256 }, (_, byte) => {
  const escaped = JSON_ESCAPES[String.fromCharCode(byte)];
  return escaped === undefined ? undefined : Buffer.from(escaped);
});

function jsonEscapeChar(c: string): string {
  return JSON_ESCAPES[c] as string;
}

function jsonString(
  s: string,
  escapeSlashes: boolean,
  validateUTF8: boolean,
): string {
  if (!(escapeSlashes ? JSON_ESCAPE_TEST_SLASH : JSON_ESCAPE_TEST).test(s)) {
    return '"' + s + '"';
  }
  const escaped = s.replace(
    escapeSlashes ? JSON_ESCAPE_SLASH : JSON_ESCAPE,
    jsonEscapeChar,
  );
  return '"' + (validateUTF8 ? replaceInvalidUTF8(escaped) : escaped) + '"';
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const FLOAT32 = new Float32Array(1);
const FLOAT32_BITS = new Uint32Array(FLOAT32.buffer);

function float32RoundTrips(v: number, precision: number): boolean {
  return Math.fround(Number(v.toPrecision(precision))) === v;
}

/** The shortest decimal text that reads back as the same Float32 value. */
function float32Text(v: number): string {
  if (v === 0) return Object.is(v, -0) ? "-0" : "0";
  // The integers below 2^24 are exact, and no shorter text gives them.
  if (Number.isInteger(v) && v > -16777216 && v < 16777216) return String(v);
  FLOAT32[0] = v;
  let precision = 1;
  if (((FLOAT32_BITS[0] as number) & 0x7fffff) === 0) {
    // A power of two: the nearest smaller Float32 value is nearer than the
    // nearest larger value. Then more digits are not always better: try each
    // number of digits.
    while (precision < 9 && !float32RoundTrips(v, precision)) precision++;
  } else {
    // If a number of digits gives the value back, more digits do also.
    let high = 9;
    while (precision < high) {
      const middle = (precision + high) >> 1;
      if (float32RoundTrips(v, middle)) high = middle;
      else precision = middle + 1;
    }
  }
  return floatText(Number(v.toPrecision(precision)));
}

function floatText(v: number): string {
  if (v === 0 && Object.is(v, -0)) return "-0";
  const s = String(v);
  return s.includes("e+") ? s.replace("e+", "e") : s;
}

function nonFiniteText(v: number): string {
  return Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf";
}

function numberText(type: ColumnType, v: number): string {
  if (!Number.isFinite(v)) return nonFiniteText(v);
  if (type.kind === "BFloat16" || (type.kind === "Float" && type.bits === 32)) {
    return float32Text(v);
  }
  return floatText(v);
}

function isInterval(type: ColumnType): boolean {
  return type.kind === "Int" && type.name.startsWith("Interval");
}

/** The number of 100-nanosecond ticks in each interval unit that has a
 *  fixed length. */
const KUSTO_TICKS: Record<string, bigint> = {
  IntervalMicrosecond: 10n,
  IntervalMillisecond: 10_000n,
  IntervalSecond: 10_000_000n,
  IntervalMinute: 600_000_000n,
  IntervalHour: 36_000_000_000n,
  IntervalDay: 864_000_000_000n,
  IntervalWeek: 6_048_000_000_000n,
};

function pad2(n: bigint): string {
  return n < 10n ? "0" + n : String(n);
}

/** An interval as a Kusto timespan, `[-][d.]hh:mm:ss[.fffffff]`
 *  (`interval_output_format = 'kusto'`). */
function kustoInterval(type: ColumnType, value: unknown): string {
  const v = BigInt(value as number | bigint);
  let ticks: bigint;
  if (type.name === "IntervalNanosecond") {
    if (v % 100n !== 0n) {
      throw new Error(
        "Cannot format an IntervalNanosecond that is not a multiple of 100 in Kusto timespan format",
      );
    }
    ticks = v / 100n;
  } else {
    const unit = KUSTO_TICKS[type.name];
    if (unit === undefined) {
      throw new Error(
        "Cannot format a calendar interval in Kusto timespan format",
      );
    }
    ticks = v * unit;
  }
  const negative = ticks < 0n;
  let rest = negative ? -ticks : ticks;
  const fraction = rest % 10_000_000n;
  rest /= 10_000_000n;
  const seconds = rest % 60n;
  rest /= 60n;
  const minutes = rest % 60n;
  rest /= 60n;
  const hours = rest % 24n;
  const days = rest / 24n;
  return (
    (negative ? "-" : "") +
    (days > 0n ? days + "." : "") +
    pad2(hours) +
    ":" +
    pad2(minutes) +
    ":" +
    pad2(seconds) +
    (fraction > 0n ? "." + fraction.toString().padStart(7, "0") : "")
  );
}

// ---------------------------------------------------------------------------
// Text forms
// ---------------------------------------------------------------------------

/** Escapes a string for the quoted text form (`'it\'s'`). */
function quotedString(s: string): string {
  return "'" + escapeText(s) + "'";
}

const ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
  "\0": "\\0",
  "\b": "\\b",
  "\f": "\\f",
  "'": "\\'",
};

/** Escapes a string as the TabSeparated format and the quoted form do. */
function escapeText(s: string): string {
  if (!/[\\\t\n\r\0\b\f']/.test(s)) return s;
  return s.replace(/[\\\t\n\r\0\b\f']/g, (c) => ESCAPES[c] as string);
}

const TABS: string[] = [""];

function tabs(count: number): string {
  for (let i = TABS.length; i <= count; i++) {
    TABS.push((TABS[i - 1] as string) + "\t");
  }
  return TABS[count] as string;
}

/** Builds a JSON object from flat paths (`a.b`) of a JSON column. */
interface PathTree {
  [key: string]: PathTree | [ColumnType, unknown];
}

/** A value of a JSON text: the text of a scalar, an object or an array. */
type JSONNode =
  | string
  | { object: Array<[key: string, value: JSONNode]> }
  | { array: JSONNode[] };

/** Reads the structure of a JSON text. The scalars and the keys stay as
 *  they are in the text. */
class JSONTextReader {
  private pos = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  read(): JSONNode {
    const node = this.value();
    this.space();
    if (this.pos !== this.text.length) throw new Error("Unexpected JSON text");
    return node;
  }

  private space(): void {
    while (/\s/.test(this.text[this.pos] ?? "")) this.pos++;
  }

  private value(): JSONNode {
    this.space();
    const c = this.text[this.pos];
    if (c === "{") {
      this.pos++;
      const object: Array<[string, JSONNode]> = [];
      this.space();
      if (this.text[this.pos] === "}") {
        this.pos++;
        return { object };
      }
      for (;;) {
        this.space();
        const key = this.string();
        this.space();
        this.expect(":");
        object.push([key, this.value()]);
        this.space();
        if (this.text[this.pos] === ",") {
          this.pos++;
        } else {
          this.expect("}");
          return { object };
        }
      }
    }
    if (c === "[") {
      this.pos++;
      const array: JSONNode[] = [];
      this.space();
      if (this.text[this.pos] === "]") {
        this.pos++;
        return { array };
      }
      for (;;) {
        array.push(this.value());
        this.space();
        if (this.text[this.pos] === ",") {
          this.pos++;
        } else {
          this.expect("]");
          return { array };
        }
      }
    }
    if (c === '"') return this.string();
    const start = this.pos;
    while (
      this.pos < this.text.length &&
      !/[\s,\]}]/.test(this.text[this.pos] as string)
    ) {
      this.pos++;
    }
    if (this.pos === start) throw new Error("Unexpected JSON text");
    return this.text.slice(start, this.pos);
  }

  private string(): string {
    const start = this.pos;
    this.expect('"');
    for (;;) {
      const c = this.text[this.pos];
      if (c === undefined) throw new Error("Unexpected end of the JSON text");
      this.pos += c === "\\" ? 2 : 1;
      if (c === '"') return this.text.slice(start, this.pos);
    }
  }

  private expect(c: string): void {
    if (this.text[this.pos] !== c) throw new Error("Unexpected JSON text");
    this.pos++;
  }
}

function isArrayNode(node: JSONNode): node is { array: JSONNode[] } {
  return typeof node !== "string" && "array" in node;
}

function isObjectNode(
  node: JSONNode,
): node is { object: Array<[string, JSONNode]> } {
  return typeof node !== "string" && "object" in node;
}

/**
 * Writes a JSON value on more than one line, as the `JSON` format of the
 * server writes a `JSON` column. The server knows the type of each array:
 * it writes an array of arrays or of objects with one element on each line,
 * and other arrays on one line. The client sees only the text, so it uses
 * the elements of the array to make the decision.
 */
function prettyJSONNode(node: JSONNode, indent: number): string {
  if (typeof node === "string") return node;
  if (isObjectNode(node)) {
    if (node.object.length === 0) return "{\n\n" + tabs(indent) + "}";
    const inner = tabs(indent + 1);
    return (
      "{\n" +
      node.object
        .map(
          ([key, value]) =>
            inner + key + ": " + prettyJSONNode(value, indent + 1),
        )
        .join(",\n") +
      "\n" +
      tabs(indent) +
      "}"
    );
  }
  const items = node.array;
  if (items.length === 0) return "[]";
  const nested =
    items.every(isArrayNode) ||
    (items.some(isObjectNode) &&
      items.every((item) => item === "null" || isObjectNode(item)));
  if (!nested) {
    return (
      "[" +
      items.map((item) => prettyJSONNode(item, indent + 1)).join(",") +
      "]"
    );
  }
  const inner = tabs(indent + 1);
  return (
    "[\n" +
    items.map((item) => inner + prettyJSONNode(item, indent + 1)).join(",\n") +
    "\n" +
    tabs(indent) +
    "]"
  );
}

/** The server writes an array on more than one line when its elements are
 *  arrays, tuples, maps or JSON objects. */
function hasNestedStructure(type: ColumnType): boolean {
  let t = type;
  while (t.kind === "Nullable" || t.kind === "LowCardinality") t = t.inner;
  return (
    t.kind === "Array" ||
    t.kind === "Tuple" ||
    t.kind === "Map" ||
    t.kind === "JSON"
  );
}

type MapType = Extract<ColumnType, { kind: "Map" }>;
type TupleType = Extract<ColumnType, { kind: "Tuple" }>;

/** True if the `JSON` format can write a value of this type on more than
 *  one line. The other values have the same text in all JSON formats. */
function canHaveLines(type: ColumnType): boolean {
  let t = type;
  while (t.kind === "Nullable" || t.kind === "LowCardinality") t = t.inner;
  return (
    t.kind === "Array" ||
    t.kind === "Tuple" ||
    t.kind === "Map" ||
    t.kind === "JSON" ||
    t.kind === "Variant" ||
    t.kind === "Dynamic"
  );
}

/** The parts of a row that are the same for all rows of a block. */
interface PrettyColumns {
  /** The text before each value: the indent, the name and `: `. */
  prefixes: string[];
  /** The value of the column can be on more than one line. */
  multiLine: boolean[];
  /** The text after the last value. */
  end: string;
  /** The number of tabs before each field. */
  indent: number;
}

/** `output_format_json_map_as_array_of_tuples`: a map is an array of
 *  `Tuple(keys K, values V)`. */
const mapEntryTypes = new WeakMap<MapType, TupleType>();

function mapEntryType(type: MapType): TupleType {
  let entry = mapEntryTypes.get(type);
  if (entry === undefined) {
    entry = {
      kind: "Tuple",
      name: `Tuple(keys ${type.key.name}, values ${type.value.name})`,
      elements: [type.key, type.value],
      names: ["keys", "values"],
    };
    mapEntryTypes.set(type, entry);
  }
  return entry;
}

function passValue(value: unknown): unknown {
  return value === undefined ? null : value;
}

/** Sets a field as `JSON.parse` does: `__proto__` is a usual field. */
function setField(
  target: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  if (name === "__proto__") {
    Object.defineProperty(target, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    target[name] = value;
  }
}

export class ValueWriter {
  /** The strings can have bytes that are not UTF-8 (lone surrogates, see
   *  `decodeString`). Only {@link value} and {@link converter} use it. */
  raw = false;
  private readonly s: OutputSettings;
  private readonly escapeSlashes: boolean;
  private readonly validateUTF8: boolean;
  private readonly kusto: boolean;

  /**
   * @param validateUTF8 Replace the bytes that are not UTF-8 with U+FFFD in
   * the JSON strings. The default is the value of
   * `output_format_json_validate_utf8`.
   */
  constructor(settings: OutputSettings, validateUTF8?: boolean) {
    this.s = settings;
    this.escapeSlashes = settings.output_format_json_escape_forward_slashes;
    this.validateUTF8 =
      validateUTF8 ?? settings.output_format_json_validate_utf8;
    this.kusto = settings.interval_output_format === "kusto";
  }

  /**
   * The value that `JSON.parse` gives for the text of {@link json}, made
   * without that text for the usual types. The other types go through the
   * text, so the result is always the same as with the text.
   */
  value(type: ColumnType, value: unknown): unknown {
    if (value === null || value === undefined) return null;
    switch (type.kind) {
      case "Int":
        if (this.kusto && isInterval(type)) return kustoInterval(type, value);
        if (type.bits >= 64) {
          // A JSON number is a double: JSON.parse rounds as Number() does.
          return this.s.output_format_json_quote_64bit_integers
            ? String(value)
            : Number(value);
        }
        return value;
      case "Float":
      case "BFloat16": {
        const v = value as number;
        if (!Number.isFinite(v)) {
          return this.s.output_format_json_quote_denormals
            ? nonFiniteText(v)
            : null;
        }
        if (type.kind === "Float" && type.bits === 64) {
          return this.s.output_format_json_quote_64bit_floats
            ? numberText(type, v)
            : v;
        }
        // The text of a Float32 is the shortest text of the 32-bit value.
        return Number(numberText(type, v));
      }
      case "Bool":
        return value ? true : false;
      case "Decimal": {
        const text = this.decimal(value as DecimalValue);
        return this.s.output_format_json_quote_decimals ? text : Number(text);
      }
      case "Nullable":
      case "LowCardinality":
        return this.value(type.inner, value);
      case "Array": {
        const items = value as unknown[];
        const out = new Array<unknown>(items.length);
        for (let i = 0; i < items.length; i++) {
          out[i] = this.value(type.inner, items[i]);
        }
        return out;
      }
      case "Tuple": {
        if (this.tupleNames(type) !== undefined) {
          return this.parsed(type, value);
        }
        const items = value as unknown[];
        const out = new Array<unknown>(type.elements.length);
        for (let i = 0; i < type.elements.length; i++) {
          out[i] = this.value(type.elements[i] as ColumnType, items[i]);
        }
        return out;
      }
      case "Variant":
      case "Dynamic": {
        const typed = value as TypedValue;
        return this.value(typed.type, typed.value);
      }
      case "Map":
        if (
          !this.s.output_format_json_map_as_array_of_tuples &&
          type.key.kind === "String"
        ) {
          const pairs = value as Array<[string, unknown]>;
          const out: Record<string, unknown> = {};
          for (const [k, v] of pairs) {
            setField(
              out,
              this.raw ? this.string(k) : k,
              this.value(type.value, v),
            );
          }
          return out;
        }
        return this.parsed(type, value);
      case "JSON":
        if (value instanceof RawJSONValue) {
          return this.parsed(type, value);
        }
        return this.jsonObjectValue(value as JSONObjectValue);
      case "Nothing":
        return null;
      default:
        // String, FixedString, Enum, UUID, IP, date and time types
        return this.string(String(value));
    }
  }

  /** Builds a JS object directly from a {@link JSONObjectValue} without
   *  round-tripping through JSON serialization and `JSON.parse`. */
  private jsonObjectValue(
    value: JSONObjectValue,
    cachedBlock?: JSONColumnarBlock,
    cachedConverters?: Array<(v: unknown) => unknown>,
  ): Record<string, unknown> {
    const root: Record<string, unknown> = {};
    const raw = this.raw;
    const block = value.block;
    if (block !== undefined && block.shared?.[value.row] === undefined) {
      const row = value.row;
      const colCount = block.paths.length;
      const converters = block === cachedBlock ? cachedConverters : undefined;
      for (let c = 0; c < colCount; c++) {
        const v = block.values[c]![row];
        if (block.skipNull[c] === 1 && v === null) continue;
        const converted =
          converters !== undefined
            ? converters[c]!(v)
            : this.value(block.types[c]!, v);
        const segs = block.segments[c];
        if (segs === undefined) {
          const key = block.paths[c]!;
          setField(root, raw ? this.string(key) : key, converted);
        } else {
          let node = root;
          const last = segs.length - 1;
          for (let i = 0; i < last; i++) {
            const part = raw ? this.string(segs[i]!) : segs[i]!;
            const child = Object.hasOwn(node, part) ? node[part] : undefined;
            if (
              typeof child !== "object" ||
              child === null ||
              Array.isArray(child)
            ) {
              const next: Record<string, unknown> = {};
              setField(node, part, next);
              node = next;
            } else {
              node = child as Record<string, unknown>;
            }
          }
          const leaf = raw ? this.string(segs[last]!) : segs[last]!;
          setField(node, leaf, converted);
        }
      }
      return root;
    }
    for (const [path, colType, v] of value.paths) {
      const converted = this.value(colType, v);
      const dot = path.indexOf(".");
      if (dot === -1) {
        setField(root, raw ? this.string(path) : path, converted);
        continue;
      }
      let node = root;
      let start = 0;
      let sep = dot;
      for (;;) {
        const rawPart = path.slice(start, sep);
        const part = raw ? this.string(rawPart) : rawPart;
        const child = Object.hasOwn(node, part) ? node[part] : undefined;
        if (
          typeof child !== "object" ||
          child === null ||
          Array.isArray(child)
        ) {
          const next: Record<string, unknown> = {};
          setField(node, part, next);
          node = next;
        } else {
          node = child as Record<string, unknown>;
        }
        start = sep + 1;
        sep = path.indexOf(".", start);
        if (sep === -1) {
          const rawLeaf = path.slice(start);
          setField(node, raw ? this.string(rawLeaf) : rawLeaf, converted);
          break;
        }
      }
    }
    return root;
  }

  /** A function that does the same as {@link value} for one type. */
  converter(type: ColumnType): (value: unknown) => unknown {
    switch (type.kind) {
      case "Int":
        if (type.bits < 64 && !(this.kusto && isInterval(type))) {
          return passValue;
        }
        break;
      case "Bool":
        return passValue;
      case "Nullable":
      case "LowCardinality":
        return this.converter(type.inner);
      case "Array": {
        const inner = this.converter(type.inner);
        return (value) => {
          if (value === null || value === undefined) return null;
          const items = value as unknown[];
          const out = new Array<unknown>(items.length);
          for (let i = 0; i < items.length; i++) out[i] = inner(items[i]);
          return out;
        };
      }
      case "JSON": {
        // Cache per-column converters across all rows of a columnar JSON block.
        let cachedBlock: JSONColumnarBlock | undefined;
        let cachedConverters: Array<(v: unknown) => unknown> | undefined;
        return (value) => {
          if (value === null || value === undefined) return null;
          if (value instanceof RawJSONValue) {
            return this.parsed(type, value);
          }
          const jsonVal = value as JSONObjectValue;
          const block = jsonVal.block;
          if (block !== undefined && block !== cachedBlock) {
            cachedBlock = block;
            cachedConverters = block.types.map((t) => this.converter(t));
          }
          return this.jsonObjectValue(jsonVal, cachedBlock, cachedConverters);
        };
      }
      case "String":
      case "FixedString":
      case "Enum":
      case "UUID":
      case "IPv4":
      case "IPv6":
      case "Date":
      case "Date32":
      case "DateTime":
      case "DateTime64":
      case "Time":
      case "Time64":
        // The decoded values of these types are strings.
        if (!this.raw) return passValue;
        break;
      default:
        break;
    }
    return (value) => this.value(type, value);
  }

  /** The string that a reader of the text gets. */
  string(s: string): string {
    if (!this.raw || !LONE_SURROGATE_TEST.test(s)) return s;
    return this.validateUTF8
      ? replaceInvalidUTF8(s)
      : encodeText(s).toString("utf8");
  }

  private parsed(type: ColumnType, value: unknown): unknown {
    let text = this.json(type, value);
    if (this.raw && !this.validateUTF8 && LONE_SURROGATE_TEST.test(text)) {
      text = encodeText(text).toString("utf8");
    }
    return JSON.parse(text);
  }

  /** Selects a JSON writer once for the values of a column. */
  jsonFormatter(type: ColumnType): (value: unknown) => string {
    switch (type.kind) {
      case "Int":
        if (this.kusto && isInterval(type)) break;
        return type.bits >= 64 && this.s.output_format_json_quote_64bit_integers
          ? (value) =>
              value === null || value === undefined
                ? "null"
                : '"' + String(value) + '"'
          : (value) =>
              value === null || value === undefined ? "null" : String(value);
      case "String":
      case "FixedString": {
        const { escapeSlashes, validateUTF8 } = this;
        return (value) =>
          value === null || value === undefined
            ? "null"
            : jsonString(value as string, escapeSlashes, validateUTF8);
      }
    }
    return (value) => this.json(type, value);
  }

  /** The value as JSON on one line, as the JSON formats write it. */
  json(type: ColumnType, value: unknown): string {
    if (value === null || value === undefined) return "null";
    switch (type.kind) {
      case "Int":
        if (this.kusto && isInterval(type)) {
          return '"' + kustoInterval(type, value) + '"';
        }
        if (type.bits >= 64 && this.s.output_format_json_quote_64bit_integers) {
          return '"' + String(value) + '"';
        }
        return String(value);
      case "Float":
      case "BFloat16": {
        const v = value as number;
        if (!Number.isFinite(v)) {
          return this.s.output_format_json_quote_denormals
            ? '"' + nonFiniteText(v) + '"'
            : "null";
        }
        const text = numberText(type, v);
        return type.kind === "Float" &&
          type.bits === 64 &&
          this.s.output_format_json_quote_64bit_floats
          ? '"' + text + '"'
          : text;
      }
      case "Bool":
        return value ? "true" : "false";
      case "Decimal": {
        const text = this.decimal(value as DecimalValue);
        return this.s.output_format_json_quote_decimals
          ? '"' + text + '"'
          : text;
      }
      case "Nullable":
      case "LowCardinality":
        return this.json(type.inner, value);
      case "Array": {
        const items = value as unknown[];
        let out = "[";
        for (let i = 0; i < items.length; i++) {
          if (i > 0) out += ",";
          out += this.json(type.inner, items[i]);
        }
        return out + "]";
      }
      case "Tuple": {
        const items = value as unknown[];
        const names = this.tupleNames(type);
        if (names !== undefined) {
          let out = "{";
          let first = true;
          for (let i = 0; i < type.elements.length; i++) {
            const item = items[i];
            if (this.skipTupleElement(item)) continue;
            out +=
              (first ? "" : ",") +
              this.key(names[i] as string) +
              ":" +
              this.json(type.elements[i] as ColumnType, item);
            first = false;
          }
          return out + "}";
        }
        let out = "[";
        for (let i = 0; i < type.elements.length; i++) {
          if (i > 0) out += ",";
          out += this.json(type.elements[i] as ColumnType, items[i]);
        }
        return out + "]";
      }
      case "Map": {
        const pairs = value as Array<[unknown, unknown]>;
        if (this.s.output_format_json_map_as_array_of_tuples) {
          const entry = mapEntryType(type);
          let out = "[";
          for (let i = 0; i < pairs.length; i++) {
            if (i > 0) out += ",";
            out += this.json(entry, pairs[i]);
          }
          return out + "]";
        }
        let out = "{";
        for (let i = 0; i < pairs.length; i++) {
          const [k, v] = pairs[i] as [unknown, unknown];
          if (i > 0) out += ",";
          out +=
            this.key(this.text(type.key, k)) + ":" + this.json(type.value, v);
        }
        return out + "}";
      }
      case "Variant":
      case "Dynamic": {
        const typed = value as TypedValue;
        return this.json(typed.type, typed.value);
      }
      case "JSON":
        if (value instanceof RawJSONValue) return this.rawJSON(value);
        return this.pathTree(this.pathsToTree(value as JSONObjectValue));
      case "Nothing":
        return "null";
      default:
        // String, FixedString, Enum, UUID, IP, date and time types
        return jsonString(String(value), this.escapeSlashes, this.validateUTF8);
    }
  }

  /**
   * The value as JSON, as the `JSON` format writes a value in a row
   * (`output_format_json_pretty_print`): tuples, maps and JSON objects have
   * one element on each line. `indent` is the number of tabs before the line
   * of the value.
   */
  pretty(type: ColumnType, value: unknown, indent: number): string {
    if (value === null || value === undefined) return "null";
    switch (type.kind) {
      case "Nullable":
      case "LowCardinality":
        return this.pretty(type.inner, value, indent);
      case "Array": {
        const items = value as unknown[];
        if (items.length === 0) return "[]";
        // The elements are always in the multi-line form. Only an array of
        // nested values has each element on its own line.
        if (!hasNestedStructure(type.inner)) {
          let out = "[";
          for (let i = 0; i < items.length; i++) {
            if (i > 0) out += ",";
            out += this.pretty(type.inner, items[i], indent + 1);
          }
          return out + "]";
        }
        const inner = tabs(indent + 1);
        let out = "[\n";
        for (let i = 0; i < items.length; i++) {
          if (i > 0) out += ",\n";
          out += inner + this.pretty(type.inner, items[i], indent + 1);
        }
        return out + "\n" + tabs(indent) + "]";
      }
      case "Tuple": {
        const items = value as unknown[];
        const names = this.tupleNames(type);
        const inner = tabs(indent + 1);
        const lines: string[] = [];
        for (let i = 0; i < type.elements.length; i++) {
          const item = items[i];
          const element = type.elements[i] as ColumnType;
          if (names === undefined) {
            lines.push(inner + this.pretty(element, item, indent + 1));
          } else if (!this.skipTupleElement(item)) {
            lines.push(
              inner +
                this.key(names[i] as string) +
                ": " +
                this.pretty(element, item, indent + 1),
            );
          }
        }
        const body = "\n" + lines.join(",\n") + "\n" + tabs(indent);
        return names === undefined ? "[" + body + "]" : "{" + body + "}";
      }
      case "Map": {
        const pairs = value as Array<[unknown, unknown]>;
        if (this.s.output_format_json_map_as_array_of_tuples) {
          if (pairs.length === 0) return "[]";
          const entry = mapEntryType(type);
          const inner = tabs(indent + 1);
          return (
            "[\n" +
            pairs
              .map((pair) => inner + this.pretty(entry, pair, indent + 1))
              .join(",\n") +
            "\n" +
            tabs(indent) +
            "]"
          );
        }
        if (pairs.length === 0) return "{}";
        const inner = tabs(indent + 1);
        return (
          "{\n" +
          pairs
            .map(
              ([k, v]) =>
                inner +
                this.key(this.text(type.key, k)) +
                ": " +
                this.pretty(type.value, v, indent + 1),
            )
            .join(",\n") +
          "\n" +
          tabs(indent) +
          "}"
        );
      }
      case "Variant":
      case "Dynamic": {
        const typed = value as TypedValue;
        return this.pretty(typed.type, typed.value, indent);
      }
      case "JSON":
        if (value instanceof RawJSONValue) {
          const text = this.rawJSON(value);
          try {
            return prettyJSONNode(new JSONTextReader(text).read(), indent);
          } catch {
            // Not the JSON text that the client expects: write it as it is.
            return text;
          }
        }
        return this.prettyPathTree(
          this.pathsToTree(value as JSONObjectValue),
          indent,
        );
      default:
        return this.json(type, value);
    }
  }

  /** The value as text, as the text formats write a value at the top level
   *  (before the escaping of the format). */
  text(type: ColumnType, value: unknown): string {
    switch (type.kind) {
      case "Nullable":
      case "LowCardinality":
        return value === null || value === undefined
          ? "\\N"
          : this.text(type.inner, value);
      case "Array":
      case "Tuple":
      case "Map":
        return this.quoted(type, value);
      case "Variant":
      case "Dynamic":
        if (value === null || value === undefined) return "\\N";
        return this.text(
          (value as TypedValue).type,
          (value as TypedValue).value,
        );
      case "JSON":
        return this.json(type, value);
      default:
        return this.scalarText(type, value);
    }
  }

  /** The value in the quoted text form, as the text formats write nested values. */
  quoted(type: ColumnType, value: unknown): string {
    if (value === null || value === undefined) return "NULL";
    switch (type.kind) {
      case "Nullable":
      case "LowCardinality":
        return this.quoted(type.inner, value);
      case "Array":
        return (
          "[" +
          (value as unknown[])
            .map((v) => this.quoted(type.inner, v))
            .join(",") +
          "]"
        );
      case "Tuple":
        return (
          "(" +
          type.elements
            .map((element, i) => this.quoted(element, (value as unknown[])[i]))
            .join(",") +
          ")"
        );
      case "Map":
        return (
          "{" +
          (value as Array<[unknown, unknown]>)
            .map(
              ([k, v]) =>
                this.quoted(type.key, k) + ":" + this.quoted(type.value, v),
            )
            .join(",") +
          "}"
        );
      case "Variant":
      case "Dynamic":
        return this.quoted(
          (value as TypedValue).type,
          (value as TypedValue).value,
        );
      case "JSON":
        return quotedString(this.json(type, value));
      case "Int":
        if (this.kusto && isInterval(type)) {
          return quotedString(kustoInterval(type, value));
        }
        return this.scalarText(type, value);
      case "Bool":
        // The quoted form does not use `bool_true_representation`.
        return value ? "true" : "false";
      case "Float":
      case "BFloat16":
      case "Decimal":
      case "Nothing":
        return this.scalarText(type, value);
      default:
        return quotedString(String(value));
    }
  }

  /** True if the text formats write the value of this type without quotes. */
  isNumeric(type: ColumnType): boolean {
    switch (type.kind) {
      case "Int":
        return !(this.kusto && isInterval(type));
      case "Float":
      case "BFloat16":
      case "Decimal":
      case "Bool":
        return true;
      default:
        return false;
    }
  }

  private scalarText(type: ColumnType, value: unknown): string {
    if (value === null || value === undefined) return "\\N";
    switch (type.kind) {
      case "Int":
        return this.kusto && isInterval(type)
          ? kustoInterval(type, value)
          : String(value);
      case "Float":
      case "BFloat16":
        return numberText(type, value as number);
      case "Bool":
        return value
          ? this.s.bool_true_representation
          : this.s.bool_false_representation;
      case "Decimal":
        return this.decimal(value as DecimalValue);
      default:
        return String(value);
    }
  }

  private decimal(value: DecimalValue): string {
    return formatDecimal(
      value.value,
      value.scale,
      this.s.output_format_decimal_trailing_zeros,
    );
  }

  /** A JSON string for a name: a column, a tuple element or a map key. */
  key(name: string): string {
    return jsonString(name, this.escapeSlashes, this.validateUTF8);
  }

  /** A JSON string in which `/` has no escape. */
  plainKey(name: string): string {
    return jsonString(name, false, this.validateUTF8);
  }

  /** The names of a tuple that the JSON formats write as an object. */
  private tupleNames(type: TupleType): string[] | undefined {
    return this.s.output_format_json_named_tuples_as_objects
      ? type.names
      : undefined;
  }

  private skipTupleElement(item: unknown): boolean {
    return (
      (item === null || item === undefined) &&
      this.s.output_format_json_skip_null_value_in_named_tuples
    );
  }

  private rawJSON(value: RawJSONValue): string {
    return this.validateUTF8 ? replaceInvalidUTF8(value.text) : value.text;
  }

  private pathsToTree(value: JSONObjectValue): PathTree {
    const root = Object.create(null) as PathTree;
    for (const [path, type, v] of value.paths) {
      const dot = path.indexOf(".");
      if (dot === -1) {
        root[path] = [type, v];
        continue;
      }
      let node = root;
      let start = 0;
      let sep = dot;
      for (;;) {
        const part = path.slice(start, sep);
        const child = node[part];
        if (child === undefined || Array.isArray(child)) {
          const next = Object.create(null) as PathTree;
          node[part] = next;
          node = next;
        } else {
          node = child;
        }
        start = sep + 1;
        sep = path.indexOf(".", start);
        if (sep === -1) {
          node[path.slice(start)] = [type, v];
          break;
        }
      }
    }
    return root;
  }

  private pathTree(tree: PathTree): string {
    const parts: string[] = [];
    for (const [key, child] of Object.entries(tree)) {
      parts.push(
        this.key(key) +
          ":" +
          (Array.isArray(child)
            ? this.json(child[0], child[1])
            : this.pathTree(child)),
      );
    }
    return "{" + parts.join(",") + "}";
  }

  private prettyPathTree(tree: PathTree, indent: number): string {
    const inner = tabs(indent + 1);
    const lines: string[] = [];
    for (const [key, child] of Object.entries(tree)) {
      lines.push(
        inner +
          this.key(key) +
          ": " +
          (Array.isArray(child)
            ? this.pretty(child[0], child[1], indent + 1)
            : this.prettyPathTree(child, indent + 1)),
      );
    }
    return "{\n" + lines.join(",\n") + "\n" + tabs(indent) + "}";
  }
}

const JSONSTRINGS_NULL = "ᴺᵁᴸᴸ";

/** How a format writes its rows. */
type Layout =
  /** One JSON object on each line: `JSONEachRow`, `JSONStringsEachRow`. */
  | "object_lines"
  /** `JSONEachRowWithProgress`. */
  | "progress"
  /** One JSON array on each line: the `JSONCompact*EachRow*` formats. */
  | "array_lines"
  /** One JSON document with objects: `JSON`, `JSONStrings`. */
  | "document"
  /** One JSON document with arrays: `JSONCompact`, `JSONCompactStrings`. */
  | "compact_document"
  | "columns"
  | "object_each_row"
  | "csv"
  | "tsv";

function layoutOf(format: DataFormat): Layout {
  switch (format) {
    case "JSON":
    case "JSONStrings":
      return "document";
    case "JSONCompact":
    case "JSONCompactStrings":
      return "compact_document";
    case "JSONColumnsWithMetadata":
      return "columns";
    case "JSONObjectEachRow":
      return "object_each_row";
    case "JSONEachRow":
    case "JSONStringsEachRow":
      return "object_lines";
    case "JSONEachRowWithProgress":
      return "progress";
    case "CSV":
    case "CSVWithNames":
    case "CSVWithNamesAndTypes":
      return "csv";
    case "TabSeparated":
    case "TabSeparatedRaw":
    case "TabSeparatedWithNames":
    case "TabSeparatedWithNamesAndTypes":
      return "tsv";
    default:
      return "array_lines";
  }
}

/** Writes the blocks of one query in one output format. */
export class OutputEncoder {
  private readonly format: DataFormat;
  private readonly layout: Layout;
  private readonly settings: OutputSettings;
  private readonly values: ValueWriter;
  private binaryRows: BinaryJSONRows | undefined;
  private columns: Array<Pick<Column, "name" | "type">> | undefined;
  private rows = 0;
  private started = false;
  private totals: Block | undefined;
  private extremes: Block | undefined;
  /** JSONColumnsWithMetadata keeps all values until the end. */
  private columnValues: string[][] = [];
  private readonly isStrings: boolean;
  /** The rows are the elements of one JSON array
   *  (`output_format_json_array_of_rows`). */
  private readonly arrayOfRows: boolean;
  /** Nested values of a row are on more than one line. */
  private readonly prettyValues: boolean;
  private readonly eol: string;

  constructor(format: DataFormat, settings: OutputSettings) {
    if (!isSupportedNativeFormat(format)) {
      throw new Error(
        `The ${format} format is not supported by the native protocol client. ` +
          `Supported formats: ${SupportedNativeFormats.join(", ")}.`,
      );
    }
    this.format = format;
    this.layout = layoutOf(format);
    this.settings = settings;
    // The formats that write one JSON document always write valid UTF-8.
    const isDocument =
      this.layout === "document" ||
      this.layout === "compact_document" ||
      this.layout === "columns";
    this.values = new ValueWriter(
      settings,
      isDocument || settings.output_format_json_validate_utf8,
    );
    this.isStrings = format.includes("Strings");
    this.arrayOfRows =
      this.layout === "object_lines" &&
      settings.output_format_json_array_of_rows;
    this.prettyValues =
      !this.isStrings && settings.output_format_json_pretty_print;
    if (this.layout === "csv") {
      this.eol = settings.output_format_csv_crlf_end_of_line ? "\r\n" : "\n";
    } else if (this.layout === "tsv") {
      this.eol = settings.output_format_tsv_crlf_end_of_line ? "\r\n" : "\n";
    } else {
      this.eol = "\n";
    }
  }

  /** Handles a Data block. Returns the text to send, if any. */
  data(block: Block): string {
    if (block.columns.length === 0) return "";
    let out = "";
    if (this.columns === undefined) {
      this.columns = block.columns.map(({ name, type }) => ({ name, type }));
      this.columnValues = this.columns.map(() => []);
      out += this.header();
    }
    if (block.rows > 0) out += this.writeRows(block);
    return out;
  }

  /** True if the format has {@link dataRows}. */
  get hasDataRows(): boolean {
    if (this.isStrings || this.arrayOfRows) return false;
    return (
      this.layout === "object_lines" ||
      this.layout === "array_lines" ||
      this.layout === "document" ||
      this.layout === "compact_document"
    );
  }

  /** These formats can write simple rows straight from the Native block. */
  get canWriteBinaryRows(): boolean {
    return (
      !this.isStrings &&
      !this.arrayOfRows &&
      (this.layout === "object_lines" || this.layout === "array_lines")
    );
  }

  /**
   * Handles a Data block as {@link data} does, but gives its rows as JS
   * values: the values that `JSON.parse` gives for the text of the rows.
   * `text` is the text of the block without its rows (for example, the start
   * of the document of the `JSON` format). In the document formats, the
   * `rows` field of the document does not count these rows.
   *
   * @param raw The block can have strings with bytes that are not UTF-8.
   */
  dataRows(block: Block, raw: boolean): { rows: unknown[]; text: string } {
    const text = this.data({
      columns: block.columns.map(({ name, type }) => ({
        name,
        type,
        values: [],
      })),
      rows: 0,
    });
    const values = this.values;
    values.raw = raw;
    const columns = block.columns;
    const count = columns.length;
    const convert = columns.map((column) => values.converter(column.type));
    const data = columns.map((column) => column.values);
    const rows = new Array<unknown>(block.rows);
    if (this.layout === "array_lines" || this.layout === "compact_document") {
      for (let r = 0; r < block.rows; r++) {
        const row = new Array<unknown>(count);
        for (let c = 0; c < count; c++) {
          row[c] = (convert[c] as (v: unknown) => unknown)(data[c]![r]);
        }
        rows[r] = row;
      }
      return { rows, text };
    }
    const names = columns.map((column) => values.string(column.name));
    const plain = !names.includes("__proto__");
    for (let r = 0; r < block.rows; r++) {
      const row: Record<string, unknown> = {};
      for (let c = 0; c < count; c++) {
        const value = (convert[c] as (v: unknown) => unknown)(data[c]![r]);
        if (plain) row[names[c] as string] = value;
        else setField(row, names[c] as string, value);
      }
      rows[r] = row;
    }
    return { rows, text };
  }

  totalsBlock(block: Block): void {
    if (block.rows > 0) this.totals = block;
  }

  extremesBlock(block: Block): void {
    if (block.rows > 0) this.extremes = block;
  }

  progress(progress: Progress): string {
    if (this.format !== "JSONEachRowWithProgress") return "";
    return (
      `{"progress":{"read_rows":"${progress.read_rows}","read_bytes":"${progress.read_bytes}",` +
      `"total_rows_to_read":"${progress.total_rows_to_read}","elapsed_ns":"${progress.elapsed_ns}"}}\n`
    );
  }

  private header(): string {
    const columns = this.columns ?? [];
    const names = columns.map((c) => c.name);
    const types = columns.map((c) => c.type.name);
    const eol = this.eol;
    switch (this.format) {
      case "JSONCompactEachRowWithNames":
      case "JSONCompactStringsEachRowWithNames":
        return this.jsonArray(names) + "\n";
      case "JSONCompactEachRowWithNamesAndTypes":
      case "JSONCompactStringsEachRowWithNamesAndTypes":
        return this.jsonArray(names) + "\n" + this.jsonArray(types) + "\n";
      case "JSONEachRowWithProgress":
        return (
          '{"meta":[' +
          columns
            .map(
              (c) =>
                `{"name":${this.values.key(c.name)},"type":${this.values.key(c.type.name)}}`,
            )
            .join(",") +
          "]}\n"
        );
      case "CSVWithNames":
        return this.csvRow(this.csvColumns().map((c) => c[0])) + eol;
      case "CSVWithNamesAndTypes": {
        const csvColumns = this.csvColumns();
        return (
          this.csvRow(csvColumns.map((c) => c[0])) +
          eol +
          this.csvRow(csvColumns.map((c) => c[1])) +
          eol
        );
      }
      case "TabSeparatedWithNames":
        return names.map(escapeText).join("\t") + eol;
      case "TabSeparatedWithNamesAndTypes":
        return (
          names.map(escapeText).join("\t") +
          eol +
          types.map(escapeText).join("\t") +
          eol
        );
      case "JSON":
      case "JSONStrings":
      case "JSONCompact":
      case "JSONCompactStrings":
        return "{\n" + this.meta(columns) + ',\n\n\t"data":\n\t[\n';
      case "JSONObjectEachRow":
        return "{\n";
      case "JSONEachRow":
      case "JSONStringsEachRow":
        return this.arrayOfRows ? "[\n" : "";
      default:
        return "";
    }
  }

  /** The CSV columns of the header: a tuple becomes one column for each
   *  element, as the values do
   *  (`output_format_csv_serialize_tuple_into_separate_columns`). */
  private csvColumns(): Array<[name: string, type: string]> {
    const split =
      this.settings.output_format_csv_serialize_tuple_into_separate_columns &&
      this.settings
        .output_format_csv_header_serialize_tuple_into_separate_columns;
    const out: Array<[string, string]> = [];
    const add = (name: string, type: ColumnType) => {
      if (type.kind === "Tuple" && split && type.elements.length > 0) {
        type.elements.forEach((element, i) =>
          add(`${name}.${type.names?.[i] ?? i + 1}`, element),
        );
      } else {
        out.push([name, type.name]);
      }
    };
    for (const column of this.columns ?? []) add(column.name, column.type);
    return out;
  }

  private jsonArray(items: string[]): string {
    return "[" + items.map((item) => this.values.key(item)).join(", ") + "]";
  }

  private csvRow(items: string[]): string {
    return items.map(csvQuote).join(this.settings.format_csv_delimiter);
  }

  private writeRows(block: Block): string {
    const rows = block.rows;
    const first = this.rows;
    this.rows += rows;
    if (!this.isStrings) {
      if (this.layout === "object_lines" && !this.arrayOfRows) {
        return this.writeJSONLines(block, this.objectPrefixes(block), "}\n");
      }
      if (this.layout === "array_lines") {
        const prefixes = block.columns.map((_, i) => (i === 0 ? "[" : ", "));
        return this.writeJSONLines(block, prefixes, "]\n");
      }
    }
    const parts = new Array<string>(rows);
    switch (this.layout) {
      case "object_lines": {
        const prefixes = this.objectPrefixes(block);
        if (!this.arrayOfRows) {
          for (let row = 0; row < rows; row++) {
            parts[row] = this.objectRow(block, row, prefixes) + "\n";
          }
          break;
        }
        for (let row = 0; row < rows; row++) {
          parts[row] =
            (this.started ? ",\n" : "") + this.objectRow(block, row, prefixes);
          this.started = true;
        }
        break;
      }
      case "progress": {
        const prefixes = this.objectPrefixes(block);
        for (let row = 0; row < rows; row++) {
          parts[row] = '{"row":' + this.objectRow(block, row, prefixes) + "}\n";
        }
        break;
      }
      case "array_lines":
        for (let row = 0; row < rows; row++) {
          parts[row] = this.arrayRow(block, row) + "\n";
        }
        break;
      case "document": {
        const pretty = this.prettyColumns(block, 2, this.prettyValues);
        for (let row = 0; row < rows; row++) {
          parts[row] =
            (this.started ? ",\n" : "") +
            this.prettyObjectRow(block, row, pretty);
          this.started = true;
        }
        break;
      }
      case "compact_document":
        for (let row = 0; row < rows; row++) {
          parts[row] =
            (this.started ? ",\n\t\t" : "\t\t") + this.arrayRow(block, row);
          this.started = true;
        }
        break;
      case "object_each_row": {
        const nameColumn =
          this.settings.format_json_object_each_row_column_for_object_name;
        const named =
          nameColumn === ""
            ? undefined
            : block.columns.find((c) => c.name === nameColumn);
        const columns =
          named === undefined
            ? block.columns
            : block.columns.filter((c) => c !== named);
        const prefixes = this.objectPrefixes({ columns });
        for (let row = 0; row < rows; row++) {
          const name =
            named === undefined
              ? `row_${first + row + 1}`
              : this.values.text(named.type, named.values[row]);
          let body = columns.length === 0 ? "{" : "";
          for (let c = 0; c < columns.length; c++) {
            const column = columns[c] as Column;
            body +=
              (prefixes[c] as string) +
              this.values.json(column.type, column.values[row]);
          }
          parts[row] =
            (this.started ? ",\n\t" : "\t") +
            this.values.plainKey(name) +
            ": " +
            body +
            "}";
          this.started = true;
        }
        break;
      }
      case "columns":
        for (let c = 0; c < block.columns.length; c++) {
          const column = block.columns[c] as Column;
          const out = this.columnValues[c] as string[];
          for (let row = 0; row < rows; row++) {
            out.push(this.jsonValue(column.type, column.values[row]));
          }
        }
        return "";
      case "csv":
        for (let row = 0; row < rows; row++) {
          parts[row] = this.csvValues(block, row) + this.eol;
        }
        break;
      case "tsv":
        for (let row = 0; row < rows; row++) {
          parts[row] = this.tsvValues(block, row) + this.eol;
        }
        break;
    }
    return parts.join("");
  }

  /** Formats each column before joining the rows. The join reuses the
   *  first field's prefix as part of the separator between rows. */
  private writeJSONLines(
    block: Block,
    prefixes: string[],
    suffix: "}\n" | "]\n",
  ): string {
    const { columns, rows } = block;
    if (columns[0]?.binary !== undefined) {
      const writer = (this.binaryRows ??= new BinaryJSONRows(
        JSON_ESCAPE_BYTES,
        this.settings.output_format_json_escape_forward_slashes,
        this.settings.output_format_json_quote_64bit_integers,
      ));
      const text = writer.write(block, prefixes, suffix);
      if (text !== undefined) return text;
    }
    const parts = new Array<string>(rows);
    const { type: firstType, values: firstValues } = columns[0] as Column;
    const formatFirst = this.values.jsonFormatter(firstType);
    for (let row = 0; row < rows; row++)
      parts[row] = formatFirst(firstValues[row]);
    for (let c = 1; c < columns.length; c++) {
      const { type, values } = columns[c] as Column;
      const format = this.values.jsonFormatter(type);
      const prefix = prefixes[c] as string;
      for (let row = 0; row < rows; row++)
        parts[row] += prefix + format(values[row]);
    }
    const start = prefixes[0] as string;
    return start + parts.join(suffix + start) + suffix;
  }

  /** One value in a JSON format. */
  private jsonValue(type: ColumnType, value: unknown): string {
    if (!this.isStrings) return this.values.json(type, value);
    if (isNull(type, value)) return '"' + JSONSTRINGS_NULL + '"';
    return this.values.key(this.values.text(type, value));
  }

  /** The text before each value of a JSON object row: `{"a":`, `,"b":`. */
  private objectPrefixes(block: Pick<Block, "columns">): string[] {
    return block.columns.map(
      (column, i) => (i === 0 ? "{" : ",") + this.values.key(column.name) + ":",
    );
  }

  private objectRow(block: Block, row: number, prefixes: string[]): string {
    const columns = block.columns;
    let out = columns.length === 0 ? "{" : "";
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c] as Column;
      out +=
        (prefixes[c] as string) +
        this.jsonValue(column.type, column.values[row]);
    }
    return out + "}";
  }

  private arrayRow(block: Block, row: number): string {
    const columns = block.columns;
    let out = "[";
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c] as Column;
      if (c > 0) out += ", ";
      out += this.jsonValue(column.type, column.values[row]);
    }
    return out + "]";
  }

  /** Prepares the rows of a block as JSON objects with one field on each
   *  line. `indent` is the number of tabs before the braces. */
  private prettyColumns(
    block: Block,
    indent: number,
    prettyValues: boolean,
  ): PrettyColumns {
    const outer = tabs(indent);
    const inner = tabs(indent + 1);
    return {
      prefixes: block.columns.map(
        (column, i) =>
          (i === 0 ? outer + "{\n" : ",\n") +
          inner +
          this.values.key(column.name) +
          ": ",
      ),
      multiLine: block.columns.map(
        (column) => prettyValues && canHaveLines(column.type),
      ),
      end: "\n" + outer + "}",
      indent: indent + 1,
    };
  }

  private prettyObjectRow(
    block: Block,
    row: number,
    pretty: PrettyColumns,
  ): string {
    const columns = block.columns;
    let out = columns.length === 0 ? tabs(pretty.indent - 1) + "{\n" : "";
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c] as Column;
      const value = column.values[row];
      out +=
        (pretty.prefixes[c] as string) +
        (pretty.multiLine[c]
          ? this.values.pretty(column.type, value, pretty.indent)
          : this.jsonValue(column.type, value));
    }
    return out + pretty.end;
  }

  private csvValues(block: Block, row: number): string {
    const fields: string[] = [];
    for (const column of block.columns) {
      this.csvField(column.type, column.values[row], fields);
    }
    return fields.join(this.settings.format_csv_delimiter);
  }

  private csvField(type: ColumnType, value: unknown, fields: string[]): void {
    if (
      (type.kind === "Variant" || type.kind === "Dynamic") &&
      value instanceof TypedValue
    ) {
      this.csvField(value.type, value.value, fields);
      return;
    }
    if (
      type.kind === "Tuple" &&
      this.settings.output_format_csv_serialize_tuple_into_separate_columns
    ) {
      // The elements are separate fields. A tuple in Nullable is one field,
      // as all other nested values. An empty tuple is one empty field.
      if (type.elements.length === 0) fields.push("");
      type.elements.forEach((element, i) =>
        this.csvField(element, (value as unknown[])[i], fields),
      );
      return;
    }
    if (isNull(type, value)) {
      fields.push(this.settings.format_csv_null_representation);
      return;
    }
    const text = this.values.text(type, value);
    fields.push(
      this.values.isNumeric(unwrapValueType(type, value))
        ? text
        : csvQuote(text),
    );
  }

  private tsvValues(block: Block, row: number): string {
    const raw = this.format === "TabSeparatedRaw";
    const columns = block.columns;
    let out = "";
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c] as Column;
      const value = column.values[row];
      if (c > 0) out += "\t";
      if (isNull(column.type, value)) {
        out += this.settings.format_tsv_null_representation;
        continue;
      }
      const text = this.values.text(column.type, value);
      const base = unwrapValueType(column.type, value);
      // Nested values are already in the quoted form.
      const nested =
        base.kind === "Array" || base.kind === "Tuple" || base.kind === "Map";
      out += raw || nested ? text : escapeText(text);
    }
    return out;
  }

  /** The text after the last block. */
  finish(stats: OutputStatistics): string {
    this.releaseBinaryBuffer();
    const columns = this.columns ?? [];
    switch (this.layout) {
      case "document":
      case "compact_document": {
        let out = this.columns === undefined ? this.header() : "";
        out += "\n\t]";
        const compact = this.layout === "compact_document";
        if (this.totals !== undefined) {
          out += compact
            ? ',\n\n\t"totals": ' + this.arrayRow(this.totals, 0)
            : ',\n\n\t"totals":\n' + this.prettyBlockRow(this.totals, 0, 1);
        }
        if (this.extremes !== undefined && this.extremes.rows >= 2) {
          out += compact
            ? ',\n\n\t"extremes":\n\t{\n\t\t"min": ' +
              this.arrayRow(this.extremes, 0) +
              ',\n\t\t"max": ' +
              this.arrayRow(this.extremes, 1) +
              "\n\t}"
            : this.prettyExtremes(this.extremes);
        }
        out += ',\n\n\t"rows": ' + this.rows;
        out += this.statistics(stats);
        return out + "\n}\n";
      }
      case "columns": {
        let out = "{\n" + this.meta(columns) + ',\n\n\t"data":\n\t{\n';
        if (this.rows > 0) {
          out += columns
            .map(
              (c, i) =>
                "\t\t" +
                this.values.key(c.name) +
                ": [" +
                (this.columnValues[i] as string[]).join(", ") +
                "]",
            )
            .join(",\n");
        }
        out += "\n\t}";
        if (this.totals !== undefined) {
          out += ',\n\n\t"totals":\n' + this.prettyBlockRow(this.totals, 0, 1);
        }
        if (this.extremes !== undefined && this.extremes.rows >= 2) {
          out += this.prettyExtremes(this.extremes);
        }
        out += ',\n\n\t"rows": ' + this.rows;
        out += this.statistics(stats);
        return out + "\n}\n";
      }
      case "object_each_row":
        return (this.columns === undefined ? "{\n" : "") + "\n}\n";
      case "object_lines":
        if (!this.arrayOfRows) return "";
        return (this.columns === undefined ? "[\n" : "") + "\n]\n";
      case "progress": {
        let out = "";
        if (this.totals !== undefined) {
          out +=
            '{"totals":' +
            this.objectRow(this.totals, 0, this.objectPrefixes(this.totals)) +
            "}\n";
        }
        if (this.extremes !== undefined && this.extremes.rows >= 2) {
          const prefixes = this.objectPrefixes(this.extremes);
          out += '{"min":' + this.objectRow(this.extremes, 0, prefixes) + "}\n";
          out += '{"max":' + this.objectRow(this.extremes, 1, prefixes) + "}\n";
        }
        if (stats.rows_before_limit_at_least !== undefined) {
          out += `{"rows_before_limit_at_least":${stats.rows_before_limit_at_least}}\n`;
        }
        return out;
      }
      case "csv":
      case "tsv": {
        let out = "";
        if (this.totals !== undefined) {
          out += this.eol + this.textRow(this.totals, 0) + this.eol;
        }
        if (this.extremes !== undefined && this.extremes.rows >= 2) {
          out +=
            this.eol +
            this.textRow(this.extremes, 0) +
            this.eol +
            this.textRow(this.extremes, 1) +
            this.eol;
        }
        return out;
      }
      default:
        return "";
    }
  }

  releaseBinaryBuffer(): void {
    this.binaryRows = undefined;
  }

  private textRow(block: Block, row: number): string {
    return this.layout === "csv"
      ? this.csvValues(block, row)
      : this.tsvValues(block, row);
  }

  /** A row of the totals or the extremes: one field on each line. Each
   *  value is on one line. */
  private prettyBlockRow(block: Block, row: number, indent: number): string {
    return this.prettyObjectRow(
      block,
      row,
      this.prettyColumns(block, indent, false),
    );
  }

  private prettyExtremes(extremes: Block): string {
    return (
      ',\n\n\t"extremes":\n\t{\n\t\t"min":\n' +
      this.prettyBlockRow(extremes, 0, 2) +
      ',\n\t\t"max":\n' +
      this.prettyBlockRow(extremes, 1, 2) +
      "\n\t}"
    );
  }

  private meta(columns: Array<Pick<Column, "name" | "type">>): string {
    return (
      '\t"meta":\n\t[\n' +
      columns
        .map(
          (c) =>
            '\t\t{\n\t\t\t"name": ' +
            this.values.key(c.name) +
            ',\n\t\t\t"type": ' +
            this.values.key(c.type.name) +
            "\n\t\t}",
        )
        .join(",\n") +
      "\n\t]"
    );
  }

  private statistics(stats: OutputStatistics): string {
    let out = "";
    if (stats.rows_before_limit_at_least !== undefined) {
      out +=
        ',\n\n\t"rows_before_limit_at_least": ' +
        stats.rows_before_limit_at_least;
    }
    if (this.settings.output_format_write_statistics) {
      out +=
        ',\n\n\t"statistics":\n\t{\n\t\t"elapsed": ' +
        Number(stats.elapsed_ns) / 1e9 +
        ',\n\t\t"rows_read": ' +
        stats.rows_read +
        ',\n\t\t"bytes_read": ' +
        stats.bytes_read +
        "\n\t}";
    }
    return out;
  }
}

function isNull(type: ColumnType, value: unknown): boolean {
  return (value === null || value === undefined) && type.kind !== "JSON";
}

/** The type of a value, through Nullable, LowCardinality, Variant and Dynamic. */
function unwrapValueType(type: ColumnType, value: unknown): ColumnType {
  let t = type;
  for (;;) {
    if (t.kind === "Nullable" || t.kind === "LowCardinality") {
      t = t.inner;
    } else if (
      (t.kind === "Variant" || t.kind === "Dynamic") &&
      value instanceof TypedValue
    ) {
      t = value.type;
      value = value.value;
    } else {
      return t;
    }
  }
}

function csvQuote(s: string): string {
  return '"' + s.replace(/"/g, '""') + '"';
}
