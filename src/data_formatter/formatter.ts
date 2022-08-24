const supportedFormats = [
  'JSON',
  'JSONEachRow',
  'JSONStringsEachRow',
  'JSONCompactEachRow',
  'JSONCompactEachRowWithNames',
  'JSONCompactEachRowWithNamesAndTypes',
  'JSONCompactStringsEachRowWithNames',
  'JSONCompactStringsEachRowWithNamesAndTypes',
  'CSV',
  'CSVWithNames',
  'CSVWithNamesAndTypes',
  'TabSeparated',
] as const
export type DataFormat = typeof supportedFormats[number]

const streamableJSONFormats = [
  'JSONEachRow',
  'JSONStringsEachRow',
  'JSONCompactEachRow',
  'JSONCompactEachRowWithNames',
  'JSONCompactEachRowWithNamesAndTypes',
  'JSONCompactStringsEachRowWithNames',
  'JSONCompactStringsEachRowWithNamesAndTypes',
] as const
type StreamableJsonDataFormat = typeof streamableJSONFormats[number]

// TODO add others formats
const streamableFormat = [
  ...streamableJSONFormats,
  'CSV',
  'TabSeparated',
  'CSVWithNamesAndTypes',
] as const
type StreamableDataFormat = typeof streamableFormat[number]

function isStreamableJSONFamily(
  format: DataFormat
): format is StreamableJsonDataFormat {
  // @ts-expect-error JSON is not assignable to streamableJSONFormats
  return streamableJSONFormats.includes(format)
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
  if (format === 'JSON') {
    return JSON.parse(text)
  }
  if (isStreamableJSONFamily(format)) {
    return text
      .split('\n')
      .filter(Boolean)
      .map((l) => decode(l, 'JSON'))
  }
  if (format === 'CSV' || format === 'TabSeparated') {
    throw new Error(`cannot decode ${format} to JSON`)
  }
  throw new Error(`The client does not support [${format}] format decoding.`)
}

/**
 * Encodes a single row of values into a string in a format acceptable by ClickHouse.
 * @param value a single value to encode.
 * @param format One of the supported formats: https://clickhouse.com/docs/en/interfaces/formats/
 * @returns string
 */
export function encode(value: any, format: DataFormat): string | Buffer {
  if (format.startsWith('CSV')) {
    return value
  }
  if (format === 'JSONCompactEachRow' || format === 'JSONEachRow') {
    return JSON.stringify(value) + '\n'
  }
  throw new Error(`The client does not support encoding in [${format}] format.`)
}
