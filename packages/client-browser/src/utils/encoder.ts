import type {
  DataFormat,
  InsertValues,
  ValuesEncoder,
} from '@clickhouse/client-common'
import { encodeJSON } from '@clickhouse/client-common/data_formatter'
import { isStream } from '@clickhouse/client-browser/utils/stream'

export class BrowserValuesEncoder implements ValuesEncoder<ReadableStream> {
  encodeValues<T = unknown>(
    values: InsertValues<T>,
    format: DataFormat
  ): string | ReadableStream {
    if (isStream(values)) {
      throw new Error('Streaming is not supported for inserts in browser')
    }
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

  validateInsertValues<T = unknown>(values: InsertValues<T>): void {
    if (isStream(values)) {
      throw new Error('Streaming is not supported for inserts in browser')
    }
    if (!Array.isArray(values) && typeof values !== 'object') {
      throw new Error(
        'Insert expected "values" to be an array or a JSON object, ' +
          `got: ${typeof values}`
      )
    }
  }
}
