export class TupleParam {
  readonly values: readonly unknown[];
  constructor(values: readonly unknown[]) {
    this.values = values;
  }
}

export function formatQueryParams({
  value,
  wrapStringInQuotes,
  printNullAsKeyword,
  escapeString,
}: FormatQueryParamsOptions): string {
  return formatQueryParamsInternal({
    value,
    wrapStringInQuotes,
    printNullAsKeyword,
    escapeString,
    isInArrayOrTuple: false,
  });
}

function formatQueryParamsInternal({
  value,
  wrapStringInQuotes,
  printNullAsKeyword,
  escapeString = true,
  isInArrayOrTuple,
}: FormatQueryParamsOptions & { isInArrayOrTuple: boolean }): string {
  if (value === null || value === undefined) {
    if (printNullAsKeyword) return "NULL";
    return "\\N";
  }
  if (Number.isNaN(value)) return "nan";
  if (value === Number.POSITIVE_INFINITY) return "+inf";
  if (value === Number.NEGATIVE_INFINITY) return "-inf";

  if (typeof value === "number" || typeof value === "bigint")
    return String(value);
  if (typeof value === "boolean") {
    if (isInArrayOrTuple) {
      return value ? "TRUE" : "FALSE";
    }
    return value ? "1" : "0";
  }
  if (typeof value === "string") {
    if (!escapeString) {
      return wrapStringInQuotes ? `'${value}'` : value;
    }
    let result = "";
    for (let i = 0; i < value.length; i++) {
      switch (value.charCodeAt(i)) {
        case TabASCII:
          result += "\\t";
          break;
        case NewlineASCII:
          result += "\\n";
          break;
        case CarriageReturnASCII:
          result += "\\r";
          break;
        case SingleQuoteASCII:
          result += `\\'`;
          break;
        case BackslashASCII:
          result += "\\\\";
          break;
        default:
          result += value[i];
      }
    }
    return wrapStringInQuotes ? `'${result}'` : result;
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((v) =>
        formatQueryParamsInternal({
          value: v,
          wrapStringInQuotes: true,
          printNullAsKeyword: true,
          isInArrayOrTuple: true,
        }),
      )
      .join(",")}]`;
  }

  if (value instanceof Date) {
    if (isInArrayOrTuple) {
      // Inside a container each element is parsed by the element type's own
      // parser: Array(Date)/Array(Date32) reject a bare Unix timestamp and only
      // accept a quoted date string. A quoted UTC 'YYYY-MM-DD' is the single
      // representation accepted by every temporal element type (Date, Date32,
      // DateTime, DateTime64).
      return `'${value.toISOString().slice(0, 10)}'`;
    }
    // The ClickHouse server parses numbers as time-zone-agnostic Unix timestamps
    const unixTimestamp = Math.floor(value.getTime() / 1000)
      .toString()
      .padStart(10, "0");
    const milliseconds = value.getUTCMilliseconds();
    return milliseconds === 0
      ? unixTimestamp
      : `${unixTimestamp}.${milliseconds.toString().padStart(3, "0")}`;
  }

  // (42,'foo',NULL)
  if (value instanceof TupleParam) {
    return `(${value.values
      .map((v) =>
        formatQueryParamsInternal({
          value: v,
          wrapStringInQuotes: true,
          printNullAsKeyword: true,
          isInArrayOrTuple: true,
        }),
      )
      .join(",")})`;
  }

  if (value instanceof Map) {
    return formatObjectLikeParam(value.entries());
  }

  // This is only useful for simple maps where the keys are strings
  if (typeof value === "object") {
    return formatObjectLikeParam(Object.entries(value));
  }

  throw new Error(`Unsupported value in query parameters: [${value}].`);
}

// {'key1':'value1',42:'value2'}
function formatObjectLikeParam(
  entries: [unknown, unknown][] | MapIterator<[unknown, unknown]>,
): string {
  const formatted: string[] = [];
  for (const [key, val] of entries) {
    formatted.push(
      `${formatQueryParamsInternal({
        value: key,
        wrapStringInQuotes: true,
        printNullAsKeyword: true,
        isInArrayOrTuple: true,
      })}:${formatQueryParamsInternal({
        value: val,
        wrapStringInQuotes: true,
        printNullAsKeyword: true,
        isInArrayOrTuple: true,
      })}`,
    );
  }
  return `{${formatted.join(",")}}`;
}

interface FormatQueryParamsOptions {
  value: unknown;
  wrapStringInQuotes?: boolean;
  // For tuples/arrays, it is required to print NULL instead of \N
  printNullAsKeyword?: boolean;
  // Set to false for {name:Identifier} placeholders sent verbatim by the server.
  escapeString?: boolean;
}

const EMPTY_IDENTIFIER_PARAMS: ReadonlySet<string> = new Set();
const DOLLAR_TAG_RE = /\$[A-Za-z0-9_]*\$/y;
const PLACEHOLDER_RE = /\s*([^\s:{}'"`\\]+)\s*:\s*([^{}]+?)\s*\}/y;

function skipQuotedToken(query: string, start: number, quote: string): number {
  let i = start + 1;
  const len = query.length;
  while (i < len) {
    const ch = query[i];
    if (ch === "\\") {
      i += 2;
    } else if (ch === quote) {
      if (i + 1 < len && query[i + 1] === quote) {
        i += 2;
      } else {
        return i + 1;
      }
    } else {
      i++;
    }
  }
  return len;
}

function skipBlockComment(query: string, start: number): number {
  let depth = 1;
  let i = start + 2;
  const len = query.length;
  while (i < len && depth > 0) {
    if (query[i] === "/" && query[i + 1] === "*") {
      depth++;
      i += 2;
    } else if (query[i] === "*" && query[i + 1] === "/") {
      depth--;
      i += 2;
    } else {
      i++;
    }
  }
  return i;
}

/** Return parameter names bound exclusively to `{name:Identifier}` placeholders. */
export function extractIdentifierParams(
  query: string | undefined,
): ReadonlySet<string> {
  if (!query || !query.includes("Identifier")) {
    return EMPTY_IDENTIFIER_PARAMS;
  }

  const identifierParams = new Set<string>();
  const otherParams = new Set<string>();
  const len = query.length;
  let i = 0;

  while (i < len) {
    const ch = query[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipQuotedToken(query, i, ch);
      continue;
    }
    if (ch === "-" && query[i + 1] === "-") {
      const nl = query.indexOf("\n", i + 2);
      i = nl === -1 ? len : nl + 1;
      continue;
    }
    if (ch === "/" && query[i + 1] === "*") {
      i = skipBlockComment(query, i);
      continue;
    }
    if (ch === "$") {
      DOLLAR_TAG_RE.lastIndex = i;
      const tagMatch = DOLLAR_TAG_RE.exec(query);
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeIdx = query.indexOf(tag, i + tag.length);
        if (closeIdx !== -1) {
          i = closeIdx + tag.length;
          continue;
        }
      }
      i++;
      continue;
    }
    if (ch === "{") {
      PLACEHOLDER_RE.lastIndex = i + 1;
      const match = PLACEHOLDER_RE.exec(query);
      const name = match?.[1];
      if (match && name !== undefined) {
        if (match[2] === "Identifier") {
          identifierParams.add(name);
        } else {
          otherParams.add(name);
        }
        i = PLACEHOLDER_RE.lastIndex;
        continue;
      }
    }
    i++;
  }

  for (const name of otherParams) {
    identifierParams.delete(name);
  }
  return identifierParams;
}

const TabASCII = 9;
const NewlineASCII = 10;
const CarriageReturnASCII = 13;
const SingleQuoteASCII = 39;
const BackslashASCII = 92;
