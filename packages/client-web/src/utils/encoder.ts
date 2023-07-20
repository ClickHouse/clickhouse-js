import type {
  DataFormat,
  InsertValues,
  ValuesEncoder,
} from '@clickhouse/client-common'
import { encodeJSON } from '@clickhouse/client-common'
import { isStream } from './stream'

export class WebValuesEncoder implements ValuesEncoder<ReadableStream> {
  encodeValues<T = unknown>(
    values: InsertValues<T>,
    format: DataFormat
  ): string | ReadableStream {
    throwIfStream(values)
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
    throwIfStream(values)
    if (!Array.isArray(values) && typeof values !== 'object') {
      throw new Error(
        'Insert expected "values" to be an array or a JSON object, ' +
          `got: ${typeof values}`
      )
    }
  }
}

function throwIfStream(values: unknown) {
  if (isStream(values)) {
    throw new Error(
      'Streaming is not supported for inserts in the web version of the client'
    )
  }
}
