import type {
  DataFormat,
  InsertValues,
  ValuesEncoder,
} from '@clickhouse/client-common'
import { encodeJSON, isSupportedRawFormat } from '@clickhouse/client-common'
import Stream from 'stream'
import { isStream, mapStream } from './stream'

export class NodeValuesEncoder implements ValuesEncoder<Stream.Readable> {
  encodeValues<T>(
    values: InsertValues<Stream.Readable, T>,
    format: DataFormat
  ): string | Stream.Readable {
    if (isStream(values)) {
      // TSV/CSV/CustomSeparated formats don't require additional serialization
      if (!values.readableObjectMode) {
        return values
      }
      // JSON* formats streams
      return Stream.pipeline(
        values,
        mapStream((value) => encodeJSON(value, format)),
        pipelineCb
      )
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

  validateInsertValues<T>(
    values: InsertValues<Stream.Readable, T>,
    format: DataFormat
  ): void {
    if (
      !Array.isArray(values) &&
      !isStream(values) &&
      typeof values !== 'object'
    ) {
      throw new Error(
        'Insert expected "values" to be an array, a stream of values or a JSON object, ' +
          `got: ${typeof values}`
      )
    }

    if (isStream(values)) {
      if (isSupportedRawFormat(format)) {
        if (values.readableObjectMode) {
          throw new Error(
            `Insert for ${format} expected Readable Stream with disabled object mode.`
          )
        }
      } else if (!values.readableObjectMode) {
        throw new Error(
          `Insert for ${format} expected Readable Stream with enabled object mode.`
        )
      }
    }
  }
}

function pipelineCb(err: NodeJS.ErrnoException | null) {
  if (err) {
    // FIXME: use logger instead
    // eslint-disable-next-line no-console
    console.error(err)
  }
}
