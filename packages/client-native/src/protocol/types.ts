/**
 * The column types that the Native format decoder knows.
 *
 * The server sends the type of each column as a string, for example
 * `Array(Nullable(String))`. {@link parseColumnType} changes this string into a
 * {@link ColumnType}. Each {@link ColumnType} keeps the original type string in
 * `name`, because the output formats (for example `JSON`) show it in `meta`.
 */
export type ColumnType =
  | IntType
  | { kind: "Float"; name: string; bits: 32 | 64 }
  | { kind: "BFloat16"; name: string }
  | { kind: "Bool"; name: string }
  | { kind: "String"; name: string }
  | { kind: "FixedString"; name: string; size: number }
  | { kind: "Decimal"; name: string; bytes: 4 | 8 | 16 | 32; scale: number }
  | { kind: "Date"; name: string }
  | { kind: "Date32"; name: string }
  | { kind: "DateTime"; name: string; timezone: string | undefined }
  | {
      kind: "DateTime64";
      name: string;
      precision: number;
      timezone: string | undefined;
    }
  | { kind: "Time"; name: string }
  | { kind: "Time64"; name: string; precision: number }
  | { kind: "UUID"; name: string }
  | { kind: "IPv4"; name: string }
  | { kind: "IPv6"; name: string }
  | { kind: "Enum"; name: string; bits: 8 | 16; values: Map<number, string> }
  | { kind: "Nullable"; name: string; inner: ColumnType }
  | { kind: "LowCardinality"; name: string; inner: ColumnType }
  | { kind: "Array"; name: string; inner: ColumnType }
  | {
      kind: "Tuple";
      name: string;
      elements: ColumnType[];
      /** Names of the elements, or `undefined` for an unnamed tuple. */
      names: string[] | undefined;
    }
  | { kind: "Map"; name: string; key: ColumnType; value: ColumnType }
  | { kind: "Variant"; name: string; variants: ColumnType[] }
  | { kind: "Dynamic"; name: string }
  | {
      kind: "JSON";
      name: string;
      /** Typed paths, sorted by path (the order of the server). */
      typed_paths: Array<[string, ColumnType]>;
    }
  | { kind: "Nothing"; name: string }
  /** The internal variant of a `Dynamic` column that holds values of types
   *  over the `max_types` limit. Each value has a binary type and a value. */
  | { kind: "SharedVariant"; name: string }
  /** A type that the client cannot decode, for example `AggregateFunction`. */
  | { kind: "Unsupported"; name: string };

export interface IntType {
  kind: "Int";
  name: string;
  bits: 8 | 16 | 32 | 64 | 128 | 256;
  signed: boolean;
}

/** Thrown when the client cannot parse a type string. */
export class TypeParseError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, TypeParseError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { t: "ident"; v: string } // identifier (can contain dots for JSON paths)
  | { t: "quoted_ident"; v: string } // `backquoted` identifier
  | { t: "string"; v: string } // 'literal'
  | { t: "number"; v: string }
  | { t: "punct"; v: "(" | ")" | "," | "=" | "[" | "]" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i] as string;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (
      c === "(" ||
      c === ")" ||
      c === "," ||
      c === "=" ||
      c === "[" ||
      c === "]"
    ) {
      tokens.push({ t: "punct", v: c });
      i++;
    } else if (c === "'" || c === "`" || c === '"') {
      const [value, end] = readQuoted(input, i);
      tokens.push(
        c === "'" ? { t: "string", v: value } : { t: "quoted_ident", v: value },
      );
      i = end;
    } else if (/[0-9+-]/.test(c)) {
      let j = i + 1;
      while (j < input.length && /[0-9.eE+-]/.test(input[j] as string)) j++;
      tokens.push({ t: "number", v: input.slice(i, j) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_.]/.test(input[j] as string)) j++;
      tokens.push({ t: "ident", v: input.slice(i, j) });
      i = j;
    } else {
      throw new TypeParseError(
        `Unexpected character '${c}' at position ${i} in type ${input}`,
      );
    }
  }
  return tokens;
}

/** Reads a quoted string or identifier that starts at `start`. Supports the
 *  backslash escapes and the doubled quote character. */
function readQuoted(input: string, start: number): [string, number] {
  const quote = input[start];
  let value = "";
  let i = start + 1;
  while (i < input.length) {
    const c = input[i] as string;
    if (c === "\\") {
      const next = input[i + 1];
      if (next === undefined) break;
      value += unescapeChar(next);
      i += 2;
    } else if (c === quote) {
      if (input[i + 1] === quote) {
        value += quote;
        i += 2;
      } else {
        return [value, i + 1];
      }
    } else {
      value += c;
      i++;
    }
  }
  throw new TypeParseError(`Unterminated quoted value in type ${input}`);
}

function unescapeChar(c: string): string {
  switch (c) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "0":
      return "\0";
    case "b":
      return "\b";
    case "f":
      return "\f";
    default:
      return c;
  }
}

// ---------------------------------------------------------------------------
// Generic syntax tree
// ---------------------------------------------------------------------------

/** A type, for example `Array(UInt8)`. */
interface RawType {
  name: string;
  args: RawArg[] | undefined;
  /** The text of the type in the input. */
  text: string;
}

type RawArg =
  | { a: "type"; type: RawType }
  | { a: "named"; name: string; type: RawType } // `name Type`
  | { a: "literal"; value: string; quoted: boolean }
  | { a: "assign"; key: string; value: string } // `'a' = 1` or `max_types = 8`
  | { a: "skip" }; // `SKIP path` / `SKIP REGEXP 'x'` in JSON

class Parser {
  private pos = 0;
  private readonly input: string;
  private readonly tokens: Token[];
  /** The start offsets of the tokens in the input, to recover the source text. */
  private readonly offsets: number[];

  constructor(input: string, tokens: Token[], offsets: number[]) {
    this.input = input;
    this.tokens = tokens;
    this.offsets = offsets;
  }

  parseType(): RawType {
    const startToken = this.pos;
    const tok = this.next();
    if (tok.t !== "ident") {
      throw this.error(`Expected a type name`);
    }
    let args: RawArg[] | undefined = undefined;
    const peek = this.peek();
    if (peek?.t === "punct" && peek.v === "(") {
      this.pos++;
      args = [];
      if (tok.v === "AggregateFunction") {
        // The client cannot decode this type. Its arguments can have values
        // that are not types (for example `sumMapFiltered([1, 2])`): skip them.
        this.skipToClosingParenthesis();
        return { name: tok.v, args, text: this.textFrom(startToken) };
      }
      if (!this.isPunct(")")) {
        for (;;) {
          args.push(this.parseArg(tok.v));
          if (this.isPunct(",")) {
            this.pos++;
            continue;
          }
          break;
        }
      }
      this.expectPunct(")");
    }
    return { name: tok.v, args, text: this.textFrom(startToken) };
  }

  /** Moves after the `)` that closes the `(` before the current token. */
  private skipToClosingParenthesis(): void {
    let depth = 1;
    while (depth > 0) {
      const tok = this.next();
      if (tok.t === "punct" && tok.v === "(") depth++;
      else if (tok.t === "punct" && tok.v === ")") depth--;
    }
  }

  private parseArg(parent: string): RawArg {
    const tok = this.peek();
    if (tok === undefined) throw this.error("Unexpected end of type");
    if (tok.t === "string" || tok.t === "number") {
      this.pos++;
      if (this.isPunct("=")) {
        this.pos++;
        const value = this.next();
        if (value.t !== "number" && value.t !== "string") {
          throw this.error("Expected a value after '='");
        }
        return { a: "assign", key: tok.v, value: value.v };
      }
      return { a: "literal", value: tok.v, quoted: tok.t === "string" };
    }
    if (parent === "JSON" && tok.t === "ident" && tok.v === "SKIP") {
      // `SKIP a.b` or `SKIP REGEXP 'x'`: the decoder does not need it.
      while (!this.isPunct(",") && !this.isPunct(")")) this.next();
      return { a: "skip" };
    }
    if (tok.t === "ident" || tok.t === "quoted_ident") {
      const after = this.tokens[this.pos + 1];
      if (after?.t === "punct" && after.v === "=") {
        this.pos += 2;
        const value = this.next();
        return { a: "assign", key: tok.v, value: value.v };
      }
      if (
        tok.t === "quoted_ident" ||
        after?.t === "ident" ||
        after?.t === "quoted_ident"
      ) {
        // `name Type`
        this.pos++;
        return { a: "named", name: tok.v, type: this.parseType() };
      }
      return { a: "type", type: this.parseType() };
    }
    throw this.error("Unexpected token");
  }

  done(): boolean {
    return this.pos >= this.tokens.length;
  }

  private next(): Token {
    const tok = this.tokens[this.pos++];
    if (tok === undefined) throw this.error("Unexpected end of type");
    return tok;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isPunct(v: string): boolean {
    const tok = this.tokens[this.pos];
    return tok !== undefined && tok.t === "punct" && tok.v === v;
  }

  private expectPunct(v: string): void {
    if (!this.isPunct(v)) throw this.error(`Expected '${v}'`);
    this.pos++;
  }

  private textFrom(startToken: number): string {
    const start = this.offsets[startToken] ?? 0;
    const end =
      this.pos < this.offsets.length
        ? (this.offsets[this.pos] as number)
        : this.input.length;
    return this.input.slice(start, end).trim().replace(/,$/, "").trim();
  }

  private error(message: string): TypeParseError {
    return new TypeParseError(
      `${message} at token ${this.pos} in type ${this.input}`,
    );
  }
}

function tokenOffsets(input: string, tokens: Token[]): number[] {
  // Re-scan the input to find where each token starts. The tokenizer skips only
  // whitespace between tokens, so the offsets follow from the token lengths.
  const offsets: number[] = [];
  let i = 0;
  for (const tok of tokens) {
    while (/\s/.test(input[i] ?? "")) i++;
    offsets.push(i);
    if (tok.t === "punct") {
      i += 1;
    } else if (tok.t === "string" || tok.t === "quoted_ident") {
      i = readQuoted(input, i)[1];
    } else {
      i += tok.v.length;
    }
  }
  return offsets;
}

// ---------------------------------------------------------------------------
// Conversion to ColumnType
// ---------------------------------------------------------------------------

const cache = new Map<string, ColumnType>();

/** Parses a ClickHouse type string, for example `LowCardinality(String)`.
 *  The results are cached, because each block repeats the column types. */
export function parseColumnType(typeString: string): ColumnType {
  const cached = cache.get(typeString);
  if (cached !== undefined) return cached;
  const tokens = tokenize(typeString);
  const parser = new Parser(
    typeString,
    tokens,
    tokenOffsets(typeString, tokens),
  );
  const raw = parser.parseType();
  if (!parser.done()) {
    throw new TypeParseError(`Unexpected trailing input in type ${typeString}`);
  }
  const result = convert(raw);
  if (cache.size > 10_000) cache.clear();
  cache.set(typeString, result);
  return result;
}

const INT_TYPES: Record<string, IntType> = {};
for (const bits of [8, 16, 32, 64, 128, 256] as const) {
  INT_TYPES[`Int${bits}`] = {
    kind: "Int",
    name: `Int${bits}`,
    bits,
    signed: true,
  };
  INT_TYPES[`UInt${bits}`] = {
    kind: "Int",
    name: `UInt${bits}`,
    bits,
    signed: false,
  };
}

const GEO_TYPES: Record<string, string> = {
  Point: "Tuple(Float64, Float64)",
  Ring: "Array(Tuple(Float64, Float64))",
  LineString: "Array(Tuple(Float64, Float64))",
  MultiLineString: "Array(Array(Tuple(Float64, Float64)))",
  Polygon: "Array(Array(Tuple(Float64, Float64)))",
  MultiPolygon: "Array(Array(Array(Tuple(Float64, Float64))))",
  Geometry:
    "Variant(LineString, MultiLineString, MultiPolygon, Point, Polygon, Ring)",
};

function typeArgs(raw: RawType): RawType[] {
  return (raw.args ?? []).map((arg) => {
    if (arg.a === "type") return arg.type;
    if (arg.a === "named") return arg.type;
    throw new TypeParseError(`Expected a type argument in ${raw.text}`);
  });
}

function literalArgs(raw: RawType): string[] {
  return (raw.args ?? []).flatMap((arg) =>
    arg.a === "literal" ? [arg.value] : [],
  );
}

function convert(raw: RawType): ColumnType {
  const name = raw.text;
  const intType = INT_TYPES[raw.name];
  if (intType !== undefined && raw.args === undefined) {
    return intType;
  }
  if (raw.name.startsWith("Interval") && raw.args === undefined) {
    return { kind: "Int", name, bits: 64, signed: true };
  }
  const geo = GEO_TYPES[raw.name];
  if (geo !== undefined && raw.args === undefined) {
    return { ...parseColumnType(geo), name };
  }
  switch (raw.name) {
    case "Float32":
      return { kind: "Float", name, bits: 32 };
    case "Float64":
      return { kind: "Float", name, bits: 64 };
    case "BFloat16":
      return { kind: "BFloat16", name };
    case "Bool":
      return { kind: "Bool", name };
    case "String":
      return { kind: "String", name };
    case "FixedString":
      return {
        kind: "FixedString",
        name,
        size: Number(literalArgs(raw)[0]),
      };
    case "Decimal": {
      const [precision, scale] = literalArgs(raw).map(Number);
      return decimalType(name, precision ?? 10, scale ?? 0);
    }
    case "Decimal32":
    case "Decimal64":
    case "Decimal128":
    case "Decimal256": {
      const scale = Number(literalArgs(raw)[0] ?? 0);
      const bytes = (Number(raw.name.slice("Decimal".length)) / 8) as
        4 | 8 | 16 | 32;
      return { kind: "Decimal", name, bytes, scale };
    }
    case "Date":
      return { kind: "Date", name };
    case "Date32":
      return { kind: "Date32", name };
    case "DateTime":
      return { kind: "DateTime", name, timezone: literalArgs(raw)[0] };
    case "DateTime32":
      return { kind: "DateTime", name, timezone: literalArgs(raw)[0] };
    case "DateTime64": {
      const [precision, timezone] = literalArgs(raw);
      return {
        kind: "DateTime64",
        name,
        precision: Number(precision ?? 3),
        timezone,
      };
    }
    case "Time":
      return { kind: "Time", name };
    case "Time64":
      return {
        kind: "Time64",
        name,
        precision: Number(literalArgs(raw)[0] ?? 3),
      };
    case "UUID":
      return { kind: "UUID", name };
    case "IPv4":
      return { kind: "IPv4", name };
    case "IPv6":
      return { kind: "IPv6", name };
    case "Enum8":
    case "Enum16":
    case "Enum": {
      const values = new Map<number, string>();
      for (const arg of raw.args ?? []) {
        if (arg.a !== "assign") {
          throw new TypeParseError(`Unexpected Enum element in ${name}`);
        }
        values.set(Number(arg.value), arg.key);
      }
      let bits: 8 | 16 = raw.name === "Enum16" ? 16 : 8;
      if (raw.name === "Enum") {
        for (const v of values.keys()) {
          if (v < -128 || v > 127) bits = 16;
        }
      }
      return { kind: "Enum", name, bits, values };
    }
    case "Nullable":
      return { kind: "Nullable", name, inner: convertSingle(raw) };
    case "LowCardinality":
      return { kind: "LowCardinality", name, inner: convertSingle(raw) };
    case "Array":
      return { kind: "Array", name, inner: convertSingle(raw) };
    case "Tuple": {
      const args = raw.args ?? [];
      const named = args.length > 0 && args.every((arg) => arg.a === "named");
      return {
        kind: "Tuple",
        name,
        elements: typeArgs(raw).map(convert),
        names: named
          ? args.map((arg) => (arg as { name: string }).name)
          : undefined,
      };
    }
    case "Nested": {
      const args = raw.args ?? [];
      const tuple: ColumnType = {
        kind: "Tuple",
        name: `Tuple(${args.map((arg) => (arg.a === "named" ? `${quoteName(arg.name)} ${arg.type.text}` : "")).join(", ")})`,
        elements: typeArgs(raw).map(convert),
        names: args.map((arg) => (arg.a === "named" ? arg.name : "")),
      };
      return { kind: "Array", name, inner: tuple };
    }
    case "Map": {
      const [key, value] = typeArgs(raw);
      if (key === undefined || value === undefined) {
        throw new TypeParseError(`Map needs two type arguments: ${name}`);
      }
      return { kind: "Map", name, key: convert(key), value: convert(value) };
    }
    case "Variant":
      return {
        kind: "Variant",
        name,
        // The server sorts the variants by name, and the global discriminators
        // follow this order. The type string from the server is already sorted.
        variants: typeArgs(raw).map(convert),
      };
    case "Dynamic":
      return { kind: "Dynamic", name };
    case "JSON": {
      const typed_paths: Array<[string, ColumnType]> = [];
      for (const arg of raw.args ?? []) {
        if (arg.a === "named") {
          typed_paths.push([arg.name, convert(arg.type)]);
        }
      }
      typed_paths.sort(([a], [b]) => compareBytes(a, b));
      return { kind: "JSON", name, typed_paths };
    }
    case "Nothing":
      return { kind: "Nothing", name };
    case "SimpleAggregateFunction": {
      // SimpleAggregateFunction(func, T) is stored as T.
      const types = (raw.args ?? []).flatMap((arg) =>
        arg.a === "type" && arg !== raw.args?.[0] ? [arg.type] : [],
      );
      const inner = types[types.length - 1];
      if (inner === undefined) {
        throw new TypeParseError(`Cannot find the stored type of ${name}`);
      }
      return { ...convert(inner), name };
    }
    case "SharedVariant":
      return { kind: "SharedVariant", name };
    default:
      return { kind: "Unsupported", name };
  }
}

function convertSingle(raw: RawType): ColumnType {
  const [inner] = typeArgs(raw);
  if (inner === undefined) {
    throw new TypeParseError(`Expected a type argument in ${raw.text}`);
  }
  return convert(inner);
}

function decimalType(
  name: string,
  precision: number,
  scale: number,
): ColumnType {
  const bytes =
    precision <= 9 ? 4 : precision <= 18 ? 8 : precision <= 38 ? 16 : 32;
  return { kind: "Decimal", name, bytes, scale };
}

function quoteName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    ? name
    : "`" + name.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
}

/** Compares two strings by their UTF-8 bytes, as the server sorts names. */
export function compareBytes(a: string, b: string): number {
  if (a === b) return 0;
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/** Removes `Nullable` and `LowCardinality` to find the stored value type. */
export function unwrapType(type: ColumnType): ColumnType {
  let t = type;
  while (t.kind === "Nullable" || t.kind === "LowCardinality") {
    t = t.inner;
  }
  return t;
}
