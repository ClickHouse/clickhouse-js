export class TupleParam {
  readonly values: readonly unknown[];
  constructor(values: readonly unknown[]) {
    this.values = values;
  }
}

// Matches a `Date` or `Date32` server type (optionally wrapped, e.g. `Nullable(Date)`),
// but not `DateTime`/`DateTime64`: the `\b` after `Date` fails on the `T` of `DateTime`.
const DATE_OR_DATE32_PARAM_RE = /\bDate(32)?\b/;

// Extracts the ClickHouse type of a bound parameter from its `{name:Type}` placeholder in the
// query, so its value can be formatted for that specific type. Returns undefined when unknown.
export function extractQueryParamType(
  query: string | undefined,
  key: string,
): string | undefined {
  if (query === undefined) return undefined;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = query.match(
    new RegExp(`\\{\\s*${escapedKey}\\s*:\\s*([^}]+?)\\s*\\}`),
  );
  return match?.[1];
}

export function formatQueryParams({
  value,
  wrapStringInQuotes,
  printNullAsKeyword,
  columnType,
}: FormatQueryParamsOptions): string {
  return formatQueryParamsInternal({
    value,
    wrapStringInQuotes,
    printNullAsKeyword,
    columnType,
    isInArrayOrTuple: false,
  });
}

function formatQueryParamsInternal({
  value,
  wrapStringInQuotes,
  printNullAsKeyword,
  columnType,
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
    // Array(Date)/Array(Date32) reject a bare Unix timestamp, so container elements are
    // always a quoted 'YYYY-MM-DD' string. A scalar is type-directed: Date/Date32 only accept
    // a date string (a Unix timestamp is rejected with BAD_QUERY_PARAMETER), while
    // DateTime/DateTime64 keep the timezone-agnostic Unix timestamp so the time of day is
    // preserved.
    if (isInArrayOrTuple) {
      return `'${value.toISOString().slice(0, 10)}'`;
    }
    if (columnType !== undefined && DATE_OR_DATE32_PARAM_RE.test(columnType)) {
      return value.toISOString().slice(0, 10);
    }
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
  // The ClickHouse type of the bound parameter (from `{name:Type}` in the query), used to
  // pick a type-correct representation for a scalar `Date` value. Undefined when unknown.
  columnType?: string;
}

const TabASCII = 9;
const NewlineASCII = 10;
const CarriageReturnASCII = 13;
const SingleQuoteASCII = 39;
const BackslashASCII = 92;
