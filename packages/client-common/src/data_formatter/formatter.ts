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
// Returned as { row_1: T, row_2: T, ...}
const recordsJSONFormats = ['JSONObjectEachRow'] as const
// See ResponseJSON<T> type
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
] as const

export type RawDataFormat = (typeof supportedRawFormats)[number]

export type StreamableJSONDataFormat = (typeof streamableJSONFormats)[number]
export type SingleDocumentJSONFormat =
  (typeof singleDocumentJSONFormats)[number]
export type RecordsJSONFormat = (typeof recordsJSONFormats)[number]
export type JSONDataFormat =
  | StreamableJSONDataFormat
  | SingleDocumentJSONFormat
  | RecordsJSONFormat

export type DataFormat = JSONDataFormat | RawDataFormat

// TODO add others formats
const streamableFormat = [
  ...streamableJSONFormats,
  ...supportedRawFormats,
] as const
export type StreamableDataFormat = (typeof streamableFormat)[number]

function isNotStreamableJSONFamily(
  format: DataFormat
): format is SingleDocumentJSONFormat {
  // @ts-expect-error JSON is not assignable to notStreamableJSONFormats
  return singleDocumentJSONFormats.includes(format)
}

function isStreamableJSONFamily(
  format: DataFormat
): format is StreamableJSONDataFormat {
  // @ts-expect-error JSON is not assignable to streamableJSONFormats
  return streamableJSONFormats.includes(format)
}

export function isSupportedRawFormat(dataFormat: DataFormat) {
  return (supportedRawFormats as readonly string[]).includes(dataFormat)
}

export function validateStreamFormat(
  format: any
): format is StreamableDataFormat {
  if (!streamableFormat.includes(format)) {
    throw new Error(
      `${format} format is not streamable. Streamable formats: ${streamableFormat.join(
        ','
      )}`
    )
  }
  return true
}

/**
 * Decodes a string in a ClickHouse format into a plain JavaScript object or an array of objects.
 * @param text a string in a ClickHouse data format
 * @param format One of the supported formats: https://clickhouse.com/docs/en/interfaces/formats/
 */
export function decode(text: string, format: DataFormat): any {
  if (isNotStreamableJSONFamily(format)) {
    return JSON.parse(text)
  }
  if (isStreamableJSONFamily(format)) {
    return text
      .split('\n')
      .filter(Boolean)
      .map((l) => decode(l, 'JSON'))
  }
  if (isSupportedRawFormat(format)) {
    throw new Error(`Cannot decode ${format} to JSON`)
  }
  throw new Error(`The client does not support [${format}] format decoding.`)
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
    `The client does not support JSON encoding in [${format}] format.`
  )
}
