import type {
  DataFormat,
  InsertValues,
  ValuesEncoder,
} from '@clickhouse/client-common'
import { encodeJSON, type JSONHandling } from '@clickhouse/client-common'
import { isStream } from './stream'

export class WebValuesEncoder implements ValuesEncoder<ReadableStream> {
  private readonly json: JSONHandling

  constructor(
    jsonHandling: JSONHandling = {
      parse: JSON.parse,
      stringify: JSON.stringify,
    },
  ) {
    this.json = jsonHandling
  }

  encodeValues<T = unknown>(
    values: InsertValues<T>,
    format: DataFormat,
  ): string | ReadableStream {
    throwIfStream(values)
    // JSON* arrays
    if (Array.isArray(values)) {
      return values
        .map((value) => encodeJSON(value, format, this.json.stringify))
        .join('')
    }
    // JSON & JSONObjectEachRow format input
    if (typeof values === 'object') {
      return encodeJSON(values, format, this.json.stringify)
    }
    throw new Error(
      `Cannot encode values of type ${typeof values} with ${format} format`,
    )
  }

  validateInsertValues<T = unknown>(values: InsertValues<T>): void {
    throwIfStream(values)
    if (!Array.isArray(values) && typeof values !== 'object') {
      throw new Error(
        'Insert expected "values" to be an array or a JSON object, ' +
          `got: ${typeof values}`,
      )
    }
  }
}

function throwIfStream(values: unknown) {
  if (isStream(values)) {
    throw new Error(
      'Streaming is not supported for inserts in the web version of the client',
    )
  }
}
