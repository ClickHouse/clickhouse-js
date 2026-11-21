import type Stream from "node:stream";
import type { ConnInsertParams } from "../common/index";
import type { EncodeContext } from "../protocol/encode";
import {
  InsertValueError,
  createNormalizer,
  defaultValue,
} from "../protocol/encode";
import type { ColumnType } from "../protocol/types";
import { unwrapType } from "../protocol/types";
import { isJSONObjectEachRowEntry } from "../utils/encoder";

/** The number of rows in each Native block of an INSERT. */
export const INSERT_BLOCK_ROWS = 16_384;

export const MISSING = Symbol("missing");

/** The server error for a column name that the table does not have. */
export const NO_SUCH_COLUMN_IN_TABLE = "16";

/** The server settings that change how the server reads the rows of an
 *  INSERT in a JSON format. The client does the same with the rows that it
 *  encodes as Native blocks. */
export interface InsertSettings {
  /** `input_format_skip_unknown_fields` */
  skip_unknown_fields: boolean;
  /** `input_format_null_as_default` */
  null_as_default: boolean;
  /** `input_format_defaults_for_omitted_fields` */
  defaults_for_omitted_fields: boolean;
  /** `input_format_try_infer_dates` */
  try_infer_dates: boolean;
  /** `input_format_try_infer_datetimes` */
  try_infer_datetimes: boolean;
}

export const DefaultInsertSettings: InsertSettings = {
  skip_unknown_fields: true,
  null_as_default: true,
  defaults_for_omitted_fields: true,
  try_infer_dates: true,
  try_infer_datetimes: true,
};

export const InsertSettingNames: Array<[keyof InsertSettings, string]> = [
  ["skip_unknown_fields", "input_format_skip_unknown_fields"],
  ["null_as_default", "input_format_null_as_default"],
  ["defaults_for_omitted_fields", "input_format_defaults_for_omitted_fields"],
  ["try_infer_dates", "input_format_try_infer_dates"],
  ["try_infer_datetimes", "input_format_try_infer_datetimes"],
];

export function applyInsertSettings(
  base: InsertSettings,
  values: Record<string, unknown>,
): InsertSettings {
  const result = { ...base };
  for (const [key, name] of InsertSettingNames) {
    const value = values[name];
    if (value === undefined) continue;
    const text = String(value).toLowerCase();
    result[key] = text === "1" || text === "true";
  }
  return result;
}

/** How the client changes the rows of an INSERT to values. */
export interface RowContext extends EncodeContext {
  /** When set, a row with a field that is not in the set is an error. */
  known_fields: Set<string> | undefined;
}

/** The columns of an INSERT, and where their values are in the rows. */
export interface InsertLayout {
  columns: Array<{ name: string; type: ColumnType }>;
  /** The columns of the table that have a DEFAULT expression. */
  defaults: Set<string>;
  /** See {@link columnPositions}. */
  positions: number[] | undefined;
}

/** An INSERT that waits for (or receives) Native blocks. */
export interface InsertSession {
  /** The columns that the server asks for. */
  columns: Array<{ name: string; type: ColumnType }>;
  /** The columns of the table that have a DEFAULT expression. */
  defaults: Set<string>;
  /** False if the connection cannot run another request. */
  readonly reusable: boolean;
  send(
    batch: unknown[],
    compact: boolean,
    positions: number[] | undefined,
  ): Promise<void>;
  /** Ends the data and waits for the end of the INSERT. */
  close(): Promise<void>;
}

/** The parts of the SQL that `insert()` of the common client makes:
 *  `INSERT INTO <table>[ (<columns>)] FORMAT <format>`. */
export interface InsertTarget {
  table: string;
  /** The column list with its parentheses, or `undefined`. */
  columns: string | undefined;
}

export async function readInlineQuery(
  sql: string,
  stream: Stream.Readable,
): Promise<Buffer[]> {
  const chunks: Buffer[] = [Buffer.from(sql + "\n")];
  for await (const chunk of stream) {
    chunks.push(
      typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer),
    );
  }
  return chunks;
}

/** Makes a block in the order of the columns that the server requested. */
export function encodeInsertRows(
  columns: Array<{ name: string; type: ColumnType }>,
  rows: unknown[],
  compact: boolean,
  positions: number[] | undefined,
  ctx: RowContext,
): {
  columns: Array<{ name: string; type: ColumnType; values: unknown[] }>;
  rows: number;
} {
  const rowCount = rows.length;
  const colCount = columns.length;
  const outCols = new Array<{
    name: string;
    type: ColumnType;
    values: unknown[];
  }>(colCount);
  const colValues = new Array<unknown[]>(colCount);
  const colNormalizers = new Array<(value: unknown) => unknown>(colCount);
  const colNames = new Array<string>(colCount);
  const colDefaults = new Array<unknown>(colCount);
  for (let c = 0; c < colCount; c++) {
    const col = columns[c]!;
    const values = new Array<unknown>(rowCount);
    colValues[c] = values;
    colNormalizers[c] = createNormalizer(col.type, ctx);
    colNames[c] = col.name;
    colDefaults[c] = defaultValue(col.type);
    outCols[c] = { name: col.name, type: col.type, values };
  }
  if (compact) {
    for (let r = 0; r < rowCount; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) {
        throw new InsertValueError(
          `A row of a JSONCompact format must be an array, got: ${typeof row}`,
        );
      }
      for (let c = 0; c < colCount; c++) {
        const p = positions?.[c] ?? -1;
        const v =
          p >= 0 && p < row.length && row[p] !== undefined ? row[p] : MISSING;
        colValues[c]![r] =
          v === MISSING ? colDefaults[c] : colNormalizers[c]!(v);
      }
    }
  } else {
    const knownFields = ctx.known_fields;
    for (let r = 0; r < rowCount; r++) {
      const row = rows[r];
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        throw new InsertValueError(
          `A row must be an object, got: ${typeof row}`,
        );
      }
      const obj = row as Record<string, unknown>;
      if (knownFields !== undefined) {
        for (const key in obj) {
          if (Object.hasOwn(obj, key) && !knownFields.has(key)) {
            throw new InsertValueError(
              `Unknown field ${JSON.stringify(key)} in a row (input_format_skip_unknown_fields is 0)`,
            );
          }
        }
      }
      for (let c = 0; c < colCount; c++) {
        const name = colNames[c]!;
        const v = Object.hasOwn(obj, name) ? obj[name] : undefined;
        colValues[c]![r] =
          v === undefined ? colDefaults[c] : colNormalizers[c]!(v);
      }
    }
  }
  return {
    columns: outCols,
    rows: rowCount,
  };
}

/** Unwraps `JSONObjectEachRow` entries, injecting the outer object key into
 *  `objectNameColumn` when configured. If any row already has that column,
 *  returns a JSON document so the server handles the conflict in
 *  `JSONObjectEachRow` format. */
export function unwrapJSONObjectEachRowBatch(
  batch: unknown[],
  objectNameColumn: string,
): { rows: unknown[]; conflictDoc: Record<string, unknown> | undefined } {
  const rows: unknown[] = [];
  let hasConflict = false;
  for (const item of batch) {
    if (!isJSONObjectEachRowEntry(item)) {
      rows.push(item);
      continue;
    }
    if (objectNameColumn === "") {
      rows.push(item.value);
      continue;
    }
    if (
      typeof item.value === "object" &&
      item.value !== null &&
      !Array.isArray(item.value)
    ) {
      if (Object.hasOwn(item.value, objectNameColumn)) {
        hasConflict = true;
        rows.push(item.value);
      } else {
        const copy: Record<string, unknown> = {
          ...(item.value as Record<string, unknown>),
        };
        if (objectNameColumn === "__proto__") {
          Object.defineProperty(copy, "__proto__", {
            value: item.key,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        } else {
          copy[objectNameColumn] = item.key;
        }
        rows.push(copy);
      }
    } else {
      rows.push(item.value);
    }
  }
  if (!hasConflict) {
    return { rows, conflictDoc: undefined };
  }
  const conflictDoc = Object.create(null) as Record<string, unknown>;
  for (const item of batch) {
    if (isJSONObjectEachRowEntry(item)) {
      conflictDoc[item.key] = item.value;
    }
  }
  return { rows, conflictDoc };
}

/** The names of the columns with a DEFAULT expression, from the columns
 *  description of the TableColumns packet. A line is
 *  `` `name` Type[\tDEFAULT\t<expression>] ``. */
export function columnsWithDefaults(description: string): Set<string> {
  const names = new Set<string>();
  for (const line of description.split("\n")) {
    const fields = line.split("\t");
    if (fields[1] !== "DEFAULT" && fields[1] !== "EPHEMERAL") continue;
    const head = fields[0] as string;
    const name = head.startsWith("`")
      ? parseBacktickIdentifier(head)
      : (head.split(" ")[0] as string);
    names.add(name);
  }
  return names;
}

/** Reads a backtick-quoted identifier at the start of `head`, stopping at the
 *  matching closing backtick rather than any backticks inside the column type. */
function parseBacktickIdentifier(head: string): string {
  let name = "";
  let i = 1;
  while (i < head.length) {
    const c = head[i] as string;
    if (c === "\\") {
      const next = head[i + 1];
      if (next === undefined) break;
      switch (next) {
        case "n":
          name += "\n";
          break;
        case "t":
          name += "\t";
          break;
        case "r":
          name += "\r";
          break;
        case "0":
          name += "\0";
          break;
        case "b":
          name += "\b";
          break;
        case "f":
          name += "\f";
          break;
        default:
          name += next;
          break;
      }
      i += 2;
    } else if (c === "`") {
      if (head[i + 1] === "`") {
        name += "`";
        i += 2;
      } else {
        break;
      }
    } else {
      name += c;
      i++;
    }
  }
  return name;
}

/** The value of a field of a row, or {@link MISSING}. A field with the value
 *  `undefined` is not in the JSON text of the row: it is missing. */
function fieldValue(row: Record<string, unknown>, name: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(row, name)) return MISSING;
  const value = row[name];
  return value === undefined ? MISSING : value;
}

/** True if the type itself has a NULL value. */
function acceptsNull(type: ColumnType): boolean {
  switch (type.kind) {
    case "Nullable":
    case "Variant":
    case "Dynamic":
    case "Nothing":
      return true;
    case "LowCardinality":
      return type.inner.kind === "Nullable";
    default:
      return false;
  }
}

/** True if the client does not read the text form of the values of the type
 *  (the JSONStrings formats). The server parses these values. */
export function needsTextParser(type: ColumnType): boolean {
  switch (unwrapType(type).kind) {
    case "Array":
    case "Map":
    case "Tuple":
    case "Variant":
    case "Dynamic":
    case "JSON":
      return true;
    default:
      return false;
  }
}

/** For each column of the INSERT, the index of its value in a row of a
 *  JSONCompact format (-1: the rows do not have the column). */
export function columnPositions(
  session: InsertSession,
  compact: boolean,
  names: string[] | undefined,
): number[] | undefined {
  if (!compact) return undefined;
  return session.columns.map((column, i) =>
    names === undefined ? i : names.indexOf(column.name),
  );
}

/**
 * True if the server must fill a value of the batch with a DEFAULT
 * expression: a row leaves out a column that has one, or has `null` for it
 * (`input_format_null_as_default`). A Native block cannot leave out the value
 * of one row, and the server fills a column that a block leaves out with the
 * default value of the type, not with the DEFAULT expression.
 */
export function needsServerDefaults(
  batch: unknown[],
  layout: InsertLayout,
  compact: boolean,
  settings: InsertSettings,
): boolean {
  if (layout.defaults.size === 0 || !settings.defaults_for_omitted_fields) {
    return false;
  }
  for (let c = 0; c < layout.columns.length; c++) {
    const column = layout.columns[c] as { name: string; type: ColumnType };
    if (!layout.defaults.has(column.name)) continue;
    const nullIsDefault = settings.null_as_default && !acceptsNull(column.type);
    const position = layout.positions?.[c] ?? -1;
    if (compact && position < 0) return true;
    for (const row of batch) {
      let value: unknown;
      if (compact) {
        if (!Array.isArray(row)) continue;
        value = position < row.length ? row[position] : undefined;
      } else {
        if (typeof row !== "object" || row === null) continue;
        value = fieldValue(row as Record<string, unknown>, column.name);
      }
      if (value === MISSING || value === undefined) return true;
      if (value === null && nullIsDefault) return true;
    }
  }
  return false;
}

export function parseInsertTarget(query: string): InsertTarget | undefined {
  const match = /^INSERT INTO ([\s\S]+?) FORMAT [A-Za-z0-9_]+$/.exec(query);
  if (match === null) return undefined;
  const head = (match[1] as string).trim();
  // The client does not change an INSERT into a table function: its
  // arguments and a column list look the same.
  if (/^(TABLE\s+)?FUNCTION\b/i.test(head)) return undefined;
  if (!head.endsWith(")")) return { table: head, columns: undefined };
  let depth = 0;
  for (let i = head.length - 1; i >= 0; i--) {
    const c = head[i];
    if (c === ")") depth++;
    else if (c === "(") {
      depth--;
      if (depth === 0) {
        const table = head.slice(0, i).trim();
        if (table === "") return undefined;
        return { table, columns: head.slice(i) };
      }
    }
  }
  return undefined;
}

type RequestSettings = NonNullable<
  ConnInsertParams<Stream.Readable>["clickhouse_settings"]
>;

export function withoutToken(settings: RequestSettings): RequestSettings {
  const rest = { ...settings };
  delete rest["insert_deduplication_token"];
  return rest;
}

/** The keys of the rows, in the order of their first use. */
export function rowKeys(rows: unknown[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    if (typeof row === "object" && row !== null && !Array.isArray(row)) {
      for (const key in row as Record<string, unknown>) {
        if (Object.hasOwn(row, key)) keys.add(key);
      }
    }
  }
  return [...keys];
}

export function startsWithInsert(query: string | Buffer | Buffer[]): boolean {
  // Skip comments and spaces before the first word.
  const head =
    typeof query === "string"
      ? query
      : Buffer.isBuffer(query)
        ? query.toString("utf8", 0, 4096)
        : (query[0]?.toString("utf8", 0, 4096) ?? "");
  const text = head.replace(/^(\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, "");
  return /^insert\b/i.test(text);
}
