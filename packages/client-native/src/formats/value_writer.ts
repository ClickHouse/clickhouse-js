import type { ColumnType } from "../protocol/types";
import type {
  DecimalValue,
  JSONColumnarBlock,
  JSONObjectValue,
  TypedValue,
} from "../protocol/columns";
import { RawJSONValue, encodeText } from "../protocol/columns";
import { formatDecimal } from "../protocol/text";
import { JSONTextReader, prettyJSONNode, tabs } from "./json_pretty";
import type { OutputSettings } from "./settings";

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

export const JSON_ESCAPE_BYTES = Array.from({ length: 256 }, (_, byte) => {
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
export function escapeText(s: string): string {
  if (!/[\\\t\n\r\0\b\f']/.test(s)) return s;
  return s.replace(/[\\\t\n\r\0\b\f']/g, (c) => ESCAPES[c] as string);
}

/** Builds a JSON object from flat paths (`a.b`) of a JSON column. */
interface PathTree {
  [key: string]: PathTree | [ColumnType, unknown];
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
export function canHaveLines(type: ColumnType): boolean {
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

export function passValue(value: unknown): unknown {
  return value === undefined ? null : value;
}

interface JSONBlockCache {
  block: JSONColumnarBlock;
  converters: Array<(v: unknown) => unknown>;
  paths: string[];
  flat: boolean;
  plain: boolean;
}

/** Sets a field as `JSON.parse` does: `__proto__` is a usual field. */
export function setField(
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
      case "QBit": {
        const items = value as number[];
        const out = new Array<number>(items.length);
        const direct =
          type.element.kind === "Int" ||
          (type.element.kind === "Float" && type.element.bits === 64);
        for (let i = 0; i < items.length; i++) {
          const v = items[i] as number;
          if (!Number.isFinite(v)) {
            return this.parsed(type, value);
          }
          out[i] = direct ? v : Number(numberText(type.element, v));
        }
        return out;
      }
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
    cache?: JSONBlockCache,
  ): Record<string, unknown> {
    const root: Record<string, unknown> = {};
    const raw = this.raw;
    const block = value.block;
    if (block !== undefined && block.shared?.[value.row] === undefined) {
      const row = value.row;
      const colCount = block.paths.length;
      if (cache !== undefined && cache.block === block) {
        const converters = cache.converters;
        const values = block.values;
        const skipNull = block.skipNull;
        if (cache.flat && cache.plain) {
          const paths = cache.paths;
          for (let c = 0; c < colCount; c++) {
            const v = values[c]![row];
            if (skipNull[c] === 1 && v === null) continue;
            const fn = converters[c]!;
            root[paths[c]!] = fn === passValue ? v : fn(v);
          }
          return root;
        }
        const segments = block.segments;
        const paths = cache.paths;
        for (let c = 0; c < colCount; c++) {
          const v = values[c]![row];
          if (skipNull[c] === 1 && v === null) continue;
          const fn = converters[c]!;
          const converted = fn === passValue ? v : fn(v);
          const segs = segments[c];
          if (segs === undefined) {
            setField(root, paths[c]!, converted);
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
      for (let c = 0; c < colCount; c++) {
        const v = block.values[c]![row];
        if (block.skipNull[c] === 1 && v === null) continue;
        const converted = this.value(block.types[c]!, v);
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
        if (!(this.kusto && isInterval(type))) {
          if (type.bits < 64) return passValue;
          return this.s.output_format_json_quote_64bit_integers
            ? (v) => (v === null || v === undefined ? null : String(v))
            : (v) => (v === null || v === undefined ? null : Number(v));
        }
        break;
      case "Float":
        if (type.bits === 64 && !this.s.output_format_json_quote_64bit_floats) {
          const denormal = this.s.output_format_json_quote_denormals;
          return (value) => {
            if (value === null || value === undefined) return null;
            const v = value as number;
            return Number.isFinite(v) ? v : denormal ? nonFiniteText(v) : null;
          };
        }
        break;
      case "Bool":
        return passValue;
      case "Nullable":
      case "LowCardinality":
        return this.converter(type.inner);
      case "Array": {
        const inner = this.converter(type.inner);
        if (inner === passValue) return passValue;
        return (value) => {
          if (value === null || value === undefined) return null;
          const items = value as unknown[];
          const out = new Array<unknown>(items.length);
          for (let i = 0; i < items.length; i++) out[i] = inner(items[i]);
          return out;
        };
      }
      case "Tuple": {
        if (this.tupleNames(type) === undefined) {
          const elemConverters = type.elements.map((e) => this.converter(e));
          if (elemConverters.every((fn) => fn === passValue)) {
            return passValue;
          }
          const len = elemConverters.length;
          return (value) => {
            if (value === null || value === undefined) return null;
            const items = value as unknown[];
            const out = new Array<unknown>(len);
            for (let i = 0; i < len; i++) {
              const fn = elemConverters[i]!;
              out[i] = fn === passValue ? items[i] : fn(items[i]);
            }
            return out;
          };
        }
        break;
      }
      case "JSON": {
        // Cache per-column converters and resolved keys across all rows of a columnar JSON block.
        let cache: JSONBlockCache | undefined;
        return (value) => {
          if (value === null || value === undefined) return null;
          if (value instanceof RawJSONValue) {
            return this.raw ? this.parsed(type, value) : JSON.parse(value.text);
          }
          const jsonVal = value as JSONObjectValue;
          const block = jsonVal.block;
          if (
            block !== undefined &&
            (cache === undefined || cache.block !== block)
          ) {
            const raw = this.raw;
            const paths = raw
              ? block.paths.map((k) => this.string(k))
              : block.paths;
            let flat = true;
            let plain = true;
            for (let c = 0; c < paths.length; c++) {
              if (block.segments[c] !== undefined) flat = false;
              if (paths[c] === "__proto__") plain = false;
            }
            cache = {
              block,
              converters: block.types.map((t) => this.converter(t)),
              paths,
              flat,
              plain,
            };
          }
          return this.jsonObjectValue(jsonVal, cache);
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
      case "QBit":
        return this.qbitText(type.element, value);
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
      case "QBit":
        return this.qbitText(type.element, value);
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
      case "QBit":
        return this.qbitText(type.element, value);
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
      case "QBit":
        return true;
      default:
        return false;
    }
  }

  private qbitText(element: ColumnType, value: unknown): string {
    const items = value as number[];
    const isInt = element.kind === "Int";
    let out = "[";
    for (let i = 0; i < items.length; i++) {
      if (i > 0) out += ",";
      out += isInt ? String(items[i]) : numberText(element, items[i] as number);
    }
    return out + "]";
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
