/**
 * Render decoded `RowBinaryWithNamesAndTypes` values back into the exact text
 * ClickHouse produces for the `TabSeparated` format, so the upstream
 * `clickhouse-test` runner can diff our output against the checked-in
 * `.reference` files.
 *
 * This is the value-oracle half of the RowBinary backend: ClickHouse is the
 * byte oracle (it produces the RowBinary), our parser decodes it, and this
 * module re-serializes the decoded JS values. A faithful round-trip
 * (RowBinary-decode → TSV-render == server's TSV) is what proves the dynamic
 * header→reader path decoded every column correctly.
 *
 * The renderer is TYPE-DIRECTED: it walks the column's parsed data-type AST
 * (from `@clickhouse/datatype-parser`, the same AST the parser folds into
 * readers) alongside the decoded value, because the JS value alone is
 * insufficient to reproduce ClickHouse's text — e.g. an `Enum8` decodes to its
 * underlying integer but TSV prints the NAME, which lives only in the type.
 *
 * Two text contexts, mirroring ClickHouse's `serializeTextEscaped` (top level)
 * vs `serializeTextQuoted` (inside Array/Tuple/Map):
 *   - top level: strings/dates/etc. are escaped but UNQUOTED; NULL is `\N`.
 *   - nested:    the same values are wrapped in single quotes; NULL is `NULL`.
 * Numbers, decimals and booleans are bare in both contexts.
 *
 * Types this v1 does not yet render (Variant, JSON, Dynamic, the geo types,
 * Nested) throw {@link TSVRenderError}; the RowBinary backend treats that as a
 * decode failure for the statement, so such tests stay off the rowbinary
 * allowlist rather than silently passing through an unexercised path.
 */

import {
  parseDataType,
  NodeKind,
  type Node,
} from "@clickhouse/datatype-parser";
import { formatDecimal } from "@clickhouse/rowbinary/decimals";
import { formatTime, formatTime64 } from "@clickhouse/rowbinary/time";
import { formatUUID } from "@clickhouse/rowbinary/uuid";
import { formatIPv4, formatIPv6 } from "@clickhouse/rowbinary/ip";

/** Thrown when a column type has no TSV renderer yet (see module note). */
export class TSVRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TSVRenderError";
  }
}

/** Types whose text is unquoted+escaped at top level but single-quoted when nested. */
function renderStringish(s: string, nested: boolean): string {
  return nested ? `'${escapeQuoted(s)}'` : escapeRaw(s);
}

// C-style escapes for the control characters ClickHouse escapes in text
// formats. Backslash itself is included so a SINGLE-pass `replace` is complete:
// escaping in one pass (rather than chaining `.replace`s) avoids re-processing
// the backslashes we introduce, and lets static analysis see that `\` is
// handled.
const RAW_ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
  "\0": "\\0",
};
const QUOTED_ESCAPES: Record<string, string> = { ...RAW_ESCAPES, "'": "\\'" };

/** TabSeparated top-level escaping (`serializeTextEscaped`): backslash + delimiters. */
function escapeRaw(s: string): string {
  return s.replace(/[\\\t\n\r\0]/g, (c) => RAW_ESCAPES[c]!);
}

/** Quoted escaping (`serializeTextQuoted`): as {@link escapeRaw} plus the single quote. */
function escapeQuoted(s: string): string {
  return s.replace(/[\\\t\n\r\0']/g, (c) => QUOTED_ESCAPES[c]!);
}

/** ClickHouse's lower-case words for the non-finite floats and signed zero, else null. */
function floatSpecial(n: number): string | null {
  if (Number.isNaN(n)) return "nan";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (n === 0) return Object.is(n, -0) ? "-0" : "0";
  return null;
}

/**
 * Reconcile JS's number text with ClickHouse's: ClickHouse writes a positive
 * exponent without the `+` (`3.4028235e38`, not JS's `3.4028235e+38`); negative
 * exponents (`1e-10`) already match.
 */
function chFloatText(s: string): string {
  return s.replace("e+", "e");
}

/**
 * ClickHouse `Float64` text: the shortest decimal that round-trips to the
 * double, which is exactly what `String(number)` produces in V8 (and what
 * ClickHouse emits).
 */
function formatFloat(n: number): string {
  return floatSpecial(n) ?? chFloatText(String(n));
}

/**
 * ClickHouse `Float32` text. The parser widens a Float32 to a JS double, so
 * `String(n)` would print the double's full precision (e.g. `0.2689400017261505`
 * for a value ClickHouse prints as `0.26894`). ClickHouse instead emits the
 * shortest decimal that round-trips to the *single*-precision value, so search
 * increasing precisions for the shortest string whose `Math.fround` is `n`.
 */
function formatFloat32(n: number): string {
  const special = floatSpecial(n);
  if (special !== null) return special;
  for (let p = 1; p < 9; p++) {
    const candidate = Number(n.toPrecision(p));
    if (Math.fround(candidate) === n) return chFloatText(String(candidate));
  }
  return chFloatText(String(n));
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD` from the UTC components of the parser's `Date` (days since epoch). */
function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** `YYYY-MM-DD HH:MM:SS` in UTC. Server tz is UTC, so tz-less columns match. */
function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/**
 * `YYYY-MM-DD HH:MM:SS[.fff...]` for `DateTime64(P)`. The parser hands back
 * `[Date (whole seconds), nanoseconds]`; the P-digit fraction is the
 * nanoseconds scaled down to the column precision.
 */
function formatDateTime64(value: unknown, precision: number): string {
  const [d, ns] = value as [Date, number];
  const base = formatDateTime(d);
  if (precision <= 0) return base;
  // TRUNCATE toward the precision, matching ClickHouse's text output — never
  // round, which could nudge the fraction up to 10^precision and would then
  // need to carry into the seconds field.
  const frac = Math.trunc(ns / 10 ** (9 - precision));
  return `${base}.${String(frac).padStart(precision, "0")}`;
}

/** Map a decoded enum integer to its name via the explicit `'name' = value` pairs in the type. */
function enumName(node: Node, value: unknown): string {
  const v = BigInt(value as number);
  for (const ev of node.values) {
    if (ev.value === v) return ev.name;
  }
  throw new TSVRenderError(
    `enum value ${String(value)} not found in ${node.name}`,
  );
}

function requireArg(node: Node, index: number): Node {
  const arg = node.arguments[index];
  if (arg === undefined) {
    throw new TSVRenderError(`type ${node.name} is missing argument ${index}`);
  }
  return arg;
}

function literalInt(node: Node): number {
  if (node.kind !== NodeKind.Literal) {
    throw new TSVRenderError(`expected a literal argument in ${node.name}`);
  }
  return Number(node.value);
}

/**
 * Render one decoded value as ClickHouse TSV text. `nested` selects the quoted
 * (inside a composite) vs top-level serialization. Mirrors the type dispatch in
 * the parser's `astToReader`, so the value shapes line up by construction.
 */
export function renderValue(
  node: Node,
  value: unknown,
  nested: boolean,
): string {
  // NULL is type-independent: only the surrounding context decides its text.
  if (value === null || value === undefined) return nested ? "NULL" : "\\N";

  if (node.kind === NodeKind.EnumDataType) {
    return renderStringish(enumName(node, value), nested);
  }
  if (node.kind === NodeKind.TupleDataType) {
    return renderTuple(node, value);
  }
  if (node.kind !== NodeKind.DataType) {
    throw new TSVRenderError(`cannot render a ${node.kind} node`);
  }

  switch (node.name) {
    // --- transparent wrappers ---
    case "Nullable":
    case "LowCardinality":
      return renderValue(requireArg(node, 0), value, nested);

    // --- composites (children always render in the nested/quoted context) ---
    case "Array":
    case "QBit": {
      const elem = requireArg(node, 0);
      return `[${(value as unknown[]).map((v) => renderValue(elem, v, true)).join(",")}]`;
    }
    case "Map": {
      const keyT = requireArg(node, 0);
      const valT = requireArg(node, 1);
      const entries = [...(value as Map<unknown, unknown>)].map(
        ([k, v]) =>
          `${renderValue(keyT, k, true)}:${renderValue(valT, v, true)}`,
      );
      return `{${entries.join(",")}}`;
    }

    // --- stringish (unquoted+escaped at top level, single-quoted when nested) ---
    case "String":
    case "FixedString":
      return renderStringish(value as string, nested);
    case "UUID":
      return renderStringish(formatUUID(value as Buffer), nested);
    case "IPv4":
      return renderStringish(formatIPv4(value as number), nested);
    case "IPv6":
      return renderStringish(formatIPv6(value as Buffer), nested);
    case "Date":
    case "Date32":
      return renderStringish(formatDate(value as Date), nested);
    case "DateTime":
    case "DateTime32":
      return renderStringish(formatDateTime(value as Date), nested);
    case "DateTime64":
      return renderStringish(
        formatDateTime64(
          value,
          node.arguments.length > 0 ? literalInt(node.arguments[0]!) : 3,
        ),
        nested,
      );
    case "Time":
      return renderStringish(formatTime(value as number), nested);
    case "Time64":
      return renderStringish(
        formatTime64(value as readonly [bigint, number]),
        nested,
      );

    // --- numeric / boolean (bare in both contexts) ---
    case "Bool":
      return value ? "true" : "false";
    case "Float32":
      return formatFloat32(value as number);
    case "Float64":
    case "BFloat16":
      return formatFloat(value as number);
    case "Decimal":
    case "Decimal32":
    case "Decimal64":
    case "Decimal128":
    case "Decimal256":
      return formatDecimal(value as readonly [bigint, number]);

    default:
      // Integers (incl. 64/128/256-bit bigints) and Interval* are plain digits.
      if (
        node.name.startsWith("Int") ||
        node.name.startsWith("UInt") ||
        node.name.startsWith("Interval")
      ) {
        return String(value);
      }
      throw new TSVRenderError(`no TSV renderer for type ${node.name}`);
  }
}

/** `(a,b,c)` — named (object) or positional (array) tuples both print positionally. */
function renderTuple(node: Node, value: unknown): string {
  const cells = node.arguments.map((field, i) => {
    const name = node.element_names[i];
    const v =
      name !== undefined && name.length > 0 && !Array.isArray(value)
        ? (value as Record<string, unknown>)[name]
        : (value as unknown[])[i];
    return renderValue(field, v, true);
  });
  return `(${cells.join(",")})`;
}

/** Parse each column type string once and return a per-column top-level renderer. */
export function compileRowRenderers(
  types: string[],
): ((value: unknown) => string)[] {
  return types.map((t) => {
    const result = parseDataType(t);
    if (!result.ok() || result.ast === null) {
      throw new TSVRenderError(
        `cannot parse column type ${JSON.stringify(t)}: ${result.error?.message ?? "unknown"}`,
      );
    }
    const node = result.ast;
    return (value: unknown) => renderValue(node, value, false);
  });
}
