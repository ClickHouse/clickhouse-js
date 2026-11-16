import {
  encodeJSON,
  isStreamableJSONFamily,
  type DataFormat,
} from "./data_formatter";
import type { JSONHandling } from "./parse";
import { SAFE_PART_NAME } from "./utils/multipart";

/**
 * Input format accepted by ClickHouse for an {@link ExternalDataEntry}.
 * Includes all {@link DataFormat} values plus ClickHouse's `TSV` alias
 * for `TabSeparated`, or any other input format string supported by the server.
 */
export type ExternalDataFormat = DataFormat | "TSV" | (string & {});

/**
 * Column schema of an {@link ExternalDataEntry}, expressed either as a
 * named-columns `structure` (`'id String, n UInt32'` or `['id String', 'n UInt32']`)
 * or as positional `types` (`'String, UInt32'` or `['String', 'UInt32']`,
 * which ClickHouse names `_1`, `_2`, ...).
 */
export type ExternalDataSchema =
  | {
      /** Column names and types, e.g. `'id String, n UInt32'` or `['id String', 'n UInt32']`. */
      structure: string | ReadonlyArray<string>;
      types?: never;
    }
  | {
      /** Column types without names (ClickHouse assigns `_1`, `_2`, ...),
       *  e.g. `'String, UInt32'` or `['String', 'UInt32']`. */
      types: string | ReadonlyArray<string>;
      structure?: never;
    };

/**
 * Payload of an {@link ExternalDataEntry}:
 * - `string` or `Uint8Array` (including Node.js `Buffer`): pre-serialized payload
 *   in the entry's `format` (e.g. `TSV`, `CSV`, `Parquet`, `JSONEachRow`).
 * - `Stream`: (Node.js only) readable stream yielding encoded bytes/text or, in
 *   object mode for row-per-line JSON formats, row objects.
 * - `ReadonlyArray<unknown>`: row values encoded by the client for row-per-line
 *   JSON formats, such as `JSONEachRow` and `JSONCompactEachRow`.
 */
export type ExternalDataInput<Stream = unknown> =
  string | Uint8Array | Stream | ReadonlyArray<unknown>;

/**
 * A per-query temporary table sent over ClickHouse's HTTP external-data
 * mechanism (`multipart/form-data`).
 *
 * @see https://clickhouse.com/docs/en/engines/table-engines/special/external-data
 */
export type ExternalDataEntry<Stream = unknown> = ExternalDataSchema & {
  /** Temporary table name referenced in the SQL query.
   *  The client sends `<name>_structure` or `<name>_types`, and `<name>_format`,
   *  as URL parameters, and the server reads settings from the same parameters.
   *  Do not use a name that makes one of these keys a setting name, for example
   *  `default` (`default_format`) or `date_time_input` (`date_time_input_format`). */
  name: string;
  /** Input format of {@link data}.
   *  @default 'TabSeparated' */
  format?: ExternalDataFormat;
  /** Table payload as a pre-serialized `string` or `Uint8Array`/`Buffer`, a
   *  `Stream.Readable` (Node.js), or an array of rows (`JSON*` formats). */
  data: ExternalDataInput<Stream>;
};

/** Prepared external table ready for connection-level URL & multipart assembly. */
export interface PreparedExternalData<Stream = unknown> {
  name: string;
  structure?: string;
  types?: string;
  format?: string;
  data: string | Uint8Array | Stream;
}

/**
 * Validates an array of {@link ExternalDataEntry} definitions and normalizes
 * their schema fields and JSON row arrays into connection-ready
 * {@link PreparedExternalData}. Platform-specific stream validation/encoding is
 * performed via `encodeStream` when `entry.data` is not a `string`,
 * `Uint8Array`, or `Array`.
 */
export function prepareExternalData<Stream>(
  entries: ReadonlyArray<ExternalDataEntry<Stream>>,
  jsonHandling: JSONHandling,
  encodeStream: (
    data: Stream,
    format: string,
    name: string,
  ) => string | Uint8Array | Stream,
): PreparedExternalData<Stream>[] {
  const seenNames = new Set<string>();
  const prepared: PreparedExternalData<Stream>[] = [];

  for (const entry of entries) {
    if (!entry.name || !SAFE_PART_NAME.test(entry.name)) {
      throw new Error(
        `Invalid external_data name: "${entry.name}". ` +
          `Table names must be non-empty and match ${SAFE_PART_NAME}.`,
      );
    }
    if (
      entry.name === "query" ||
      entry.name.startsWith("param_") ||
      entry.name.endsWith("_structure") ||
      entry.name.endsWith("_types") ||
      entry.name.endsWith("_format")
    ) {
      throw new Error(
        `Invalid external_data name: "${entry.name}". ` +
          `Name collides with ClickHouse HTTP form parameter names.`,
      );
    }
    if (seenNames.has(entry.name)) {
      throw new Error(`Duplicate external_data table name: "${entry.name}".`);
    }
    seenNames.add(entry.name);

    const hasStructure = "structure" in entry && entry.structure !== undefined;
    const hasTypes = "types" in entry && entry.types !== undefined;
    if (hasStructure === hasTypes) {
      throw new Error(
        `external_data "${entry.name}" must specify exactly one of "structure" or "types".`,
      );
    }

    const structure = hasStructure
      ? normalizeSchemaField(entry.structure!, "structure", entry.name)
      : undefined;
    const types = hasTypes
      ? normalizeSchemaField(entry.types!, "types", entry.name)
      : undefined;

    const format = entry.format;
    const effectiveFormat = format ?? "TabSeparated";

    let data: string | Uint8Array | Stream;
    if (typeof entry.data === "string" || entry.data instanceof Uint8Array) {
      data = entry.data;
    } else if (Array.isArray(entry.data)) {
      data = encodeExternalDataJsonArray(
        entry.data,
        effectiveFormat,
        jsonHandling,
        entry.name,
      );
    } else {
      data = encodeStream(entry.data as Stream, effectiveFormat, entry.name);
    }

    prepared.push({
      name: entry.name,
      structure,
      types,
      format,
      data,
    });
  }

  return prepared;
}

function normalizeSchemaField(
  field: string | ReadonlyArray<string>,
  kind: "structure" | "types",
  tableName: string,
): string {
  const normalized =
    typeof field === "string"
      ? field.trim()
      : field
          .map((s) => s.trim())
          .filter(Boolean)
          .join(", ");
  if (normalized.length === 0) {
    throw new Error(
      `external_data "${tableName}" has an empty "${kind}" definition.`,
    );
  }
  return normalized;
}

function encodeExternalDataJsonArray(
  rows: ReadonlyArray<unknown>,
  format: string,
  jsonHandling: JSONHandling,
  tableName: string,
): string {
  if (!isStreamableJSONFamily(format as DataFormat)) {
    throw new Error(
      `external_data "${tableName}": array data is only supported for row-per-line JSON formats such as JSONEachRow or JSONCompactEachRow (got "${format}"). ` +
        `For other formats, pass pre-serialized data as a string, Uint8Array/Buffer, or stream.`,
    );
  }
  if (rows.length === 0) {
    return "";
  }
  const lines = new Array<string>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    lines[i] = encodeJSON(
      rows[i],
      format as DataFormat,
      jsonHandling.stringify,
    );
  }
  return lines.join("");
}
