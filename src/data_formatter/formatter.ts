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
const singleDocumentJSONFormats = [
  'JSON',
  'JSONStrings',
  'JSONCompact',
  'JSONCompactStrings',
  'JSONColumnsWithMetadata',
  'JSONObjectEachRow',
] as const
const supportedJSONFormats = [
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
] as const

export type JSONDataFormat = (typeof supportedJSONFormats)[number]
export type RawDataFormat = (typeof supportedRawFormats)[number]
export type DataFormat = JSONDataFormat | RawDataFormat

type SingleDocumentStreamableJsonDataFormat =
  (typeof singleDocumentJSONFormats)[number]
type StreamableJsonDataFormat = (typeof streamableJSONFormats)[number]

// TODO add others formats
const streamableFormat = [
  ...streamableJSONFormats,
  ...supportedRawFormats,
] as const
type StreamableDataFormat = (typeof streamableFormat)[number]

function isNotStreamableJSONFamily(
  format: DataFormat
): format is SingleDocumentStreamableJsonDataFormat {
  // @ts-expect-error JSON is not assignable to notStreamableJSONFormats
  return singleDocumentJSONFormats.includes(format)
}

function isStreamableJSONFamily(
  format: DataFormat
): format is StreamableJsonDataFormat {
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
