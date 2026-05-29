import type { JSONHandling } from '../parse'

export const StreamableJSONFormats = [
  'JSONEachRow',
  'JSONStringsEachRow',
  'JSONCompactEachRow',
  'JSONCompactStringsEachRow',
  'JSONCompactEachRowWithNames',
  'JSONCompactEachRowWithNamesAndTypes',
  'JSONCompactStringsEachRowWithNames',
  'JSONCompactStringsEachRowWithNamesAndTypes',
  'JSONEachRowWithProgress',
] as const
export const RecordsJSONFormats = ['JSONObjectEachRow'] as const
export const SingleDocumentJSONFormats = [
  'JSON',
  'JSONStrings',
  'JSONCompact',
  'JSONCompactStrings',
  'JSONColumnsWithMetadata',
] as const
export const SupportedJSONFormats = [
  ...RecordsJSONFormats,
  ...SingleDocumentJSONFormats,
  ...StreamableJSONFormats,
] as const
export const SupportedRawFormats = [
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
] as const
export const StreamableFormats = [
  ...StreamableJSONFormats,
  ...SupportedRawFormats,
] as const

/** CSV, TSV, etc. - can be streamed, but cannot be decoded as JSON. */
export type RawDataFormat = (typeof SupportedRawFormats)[number]

/** Each row is returned as a separate JSON object or an array, and these formats can be streamed. */
export type StreamableJSONDataFormat = (typeof StreamableJSONFormats)[number]

/** Returned as a single {@link ResponseJSON} object, cannot be streamed. */
export type SingleDocumentJSONFormat =
  (typeof SingleDocumentJSONFormats)[number]

/** Returned as a single object { row_1: T, row_2: T, ...} <br/>
 *  (i.e. Record<string, T>), cannot be streamed. */
export type RecordsJSONFormat = (typeof RecordsJSONFormats)[number]

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

/** All data formats that can be streamed, whether it can be decoded as JSON or not. */
export type StreamableDataFormat = (typeof StreamableFormats)[number]

export function isNotStreamableJSONFamily(
  format: DataFormat,
): format is SingleDocumentJSONFormat {
  return (
    (SingleDocumentJSONFormats as readonly string[]).includes(format) ||
    (RecordsJSONFormats as readonly string[]).includes(format)
  )
}

export function isStreamableJSONFamily(
  format: DataFormat,
): format is StreamableJSONDataFormat {
  return (StreamableJSONFormats as readonly string[]).includes(format)
}

export function isSupportedRawFormat(dataFormat: DataFormat) {
  return (SupportedRawFormats as readonly string[]).includes(dataFormat)
}

export function validateStreamFormat(
  format: any,
): format is StreamableDataFormat {
  if (!StreamableFormats.includes(format)) {
    throw new Error(
      `${format} format is not streamable. Streamable formats: ${StreamableFormats.join(
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
export function encodeJSON(
  value: any,
  format: DataFormat,
  stringifyFn: JSONHandling['stringify'],
): string {
  if ((SupportedJSONFormats as readonly string[]).includes(format)) {
    return stringifyFn(value) + '\n'
  }
  throw new Error(
    `The client does not support JSON encoding in [${format}] format.`,
  )
}
