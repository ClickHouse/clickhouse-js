import type {
  DataFormat,
  InsertValues,
  ValuesEncoder,
} from '@clickhouse/client-common'
import { encodeJSON } from '@clickhouse/client-common/data_formatter'

export class BrowserValuesEncoder implements ValuesEncoder<ReadableStream> {
  encodeValues<T = unknown>(
    values: InsertValues<ReadableStream, T>,
    format: DataFormat
  ): string | ReadableStream {
    // JSON* arrays
    if (Array.isArray(values)) {
      return values.map((value) => encodeJSON(value, format)).join('')
    }
    // JSON & JSONObjectEachRow format input
    if (typeof values === 'object') {
      return encodeJSON(values, format)
    }
    throw new Error(
      `Cannot encode values of type ${typeof values} with ${format} format`
    )
  }

  validateInsertValues<T = unknown>(
    values: InsertValues<ReadableStream, T>
    // _format: DataFormat
  ): void {
    if (!Array.isArray(values) && typeof values !== 'object') {
      throw new Error(
        'Insert expected "values" to be an array, a stream of values or a JSON object, ' +
          `got: ${typeof values}`
      )
    }
  }
}
