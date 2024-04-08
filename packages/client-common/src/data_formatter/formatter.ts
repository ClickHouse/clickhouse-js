const streamableJSONFormats = [
  'JSONEachRow',
  'JSONStringsEachRow',
  'JSONCompactEachRow',
  'JSONCompactStringsEachRow',
  'JSONCompactEachRowWithNames',
  'JSONCompactEachRowWithNamesAndTypes',
  'JSONCompactStringsEachRowWithNames',
  'JSONCompactStringsEachRowWithNamesAndTypes',
] as const
const recordsJSONFormats = ['JSONObjectEachRow'] as const
const singleDocumentJSONFormats = [
  'JSON',
  'JSONStrings',
  'JSONCompact',
  'JSONCompactStrings',
  'JSONColumnsWithMetadata',
] as const
const supportedJSONFormats = [
  ...recordsJSONFormats,
  ...singleDocumentJSONFormats,
  ...streamableJSONFormats,
] as const
const supportedRawFormats = [
  'CSV',
  'CSVWithNames',
  'CSVWithNamesAndTypes',
  'TabSeparated',
  'TabSeparatedRaw',
  'TabSeparatedWithNames',
  'TabSeparatedWithNamesAndTypes',
  'CustomSeparated',
  'CustomSeparatedWithNames',
  'CustomSeparatedWithNamesAndTypes',
  'Parquet',
  // translates to RowBinaryWithNamesAndTypes under the hood (see client/formatQuery);
  // we expose a shorter name to the user for simplicity.
  'RowBinary',
] as const

/** CSV, TSV, etc. - can be streamed, but cannot be decoded as JSON. */
export type RawDataFormat = (typeof supportedRawFormats)[number]

/** Each row is returned as a separate JSON object or an array, and these formats can be streamed. */
export type StreamableJSONDataFormat = (typeof streamableJSONFormats)[number]

/** Returned as a single {@link ResponseJSON} object, cannot be streamed. */
export type SingleDocumentJSONFormat =
  (typeof singleDocumentJSONFormats)[number]

/** Returned as a single object { row_1: T, row_2: T, ...} <br/>
 *  (i.e. Record<string, T>), cannot be streamed. */
export type RecordsJSONFormat = (typeof recordsJSONFormats)[number]

/** All allowed JSON formats, whether streamable or not. */
export type JSONDataFormat =
  | StreamableJSONDataFormat
  | SingleDocumentJSONFormat
  | RecordsJSONFormat

/** Data formats that are currently supported by the client. <br/>
 *  This is a union of the following types:<br/>
 *  * {@link JSONDataFormat}
 *  * {@link RawDataFormat}
 *  * {@link StreamableDataFormat}
 *  * {@link StreamableJSONDataFormat}
 *  * {@link SingleDocumentJSONFormat}
 *  * {@link RecordsJSONFormat}
 *  @see https://clickhouse.com/docs/en/interfaces/formats */
export type DataFormat = JSONDataFormat | RawDataFormat

const streamableFormat = [
  ...streamableJSONFormats,
  ...supportedRawFormats,
] as const

/** All data formats that can be streamed, whether it can be decoded as JSON or not. */
export type StreamableDataFormat = (typeof streamableFormat)[number]

export function isNotStreamableJSONFamily(
  format: DataFormat,
): format is SingleDocumentJSONFormat {
  return (
    (singleDocumentJSONFormats as readonly string[]).includes(format) ||
    (recordsJSONFormats as readonly string[]).includes(format)
  )
}

export function isStreamableJSONFamily(
  format: DataFormat,
): format is StreamableJSONDataFormat {
  return (streamableJSONFormats as readonly string[]).includes(format)
}

export function isSupportedRawFormat(dataFormat: DataFormat) {
  return (supportedRawFormats as readonly string[]).includes(dataFormat)
}

export function validateStreamFormat(
  format: any,
): format is StreamableDataFormat {
  if (!streamableFormat.includes(format)) {
    throw new Error(
      `${format} format is not streamable. Streamable formats: ${streamableFormat.join(
        ',',
      )}`,
    )
  }
  return true
}

/**
 * Encodes a single row of values into a string in a JSON format acceptable by ClickHouse.
 * @param value a single value to encode.
 * @param format One of the supported JSON formats: https://clickhouse.com/docs/en/interfaces/formats/
 * @returns string
 */
export function encodeJSON(value: any, format: DataFormat): string {
  if ((supportedJSONFormats as readonly string[]).includes(format)) {
    return JSON.stringify(value) + '\n'
  }
  throw new Error(
    `The client does not support JSON encoding in [${format}] format.`,
  )
}
