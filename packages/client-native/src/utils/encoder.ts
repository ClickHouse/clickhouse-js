import type {
  DataFormat,
  InsertValues,
  JSONHandling,
  ValuesEncoder,
} from "../common/index";
import {
  defaultJSONHandling,
  encodeJSON,
  isSupportedRawFormat,
} from "../common/index";
import Stream from "stream";
import { isStream, mapStream } from "./stream";

/**
 * Prepares the values of `insert()` for the native protocol.
 *
 * - The rows of the JSON formats stay JS values, in an object-mode stream.
 *   The connection encodes them as Native blocks with the column types that
 *   the server sends.
 * - The data of the other formats (CSV, TSV, Parquet, ...) stays as it is: a
 *   string or a byte stream. The server parses it.
 */
export class NodeValuesEncoder implements ValuesEncoder<Stream.Readable> {
  private readonly json: JSONHandling;

  constructor(json: JSONHandling) {
    this.json = json;
  }

  encodeValues<T>(
    values: InsertValues<Stream.Readable, T>,
    format: DataFormat,
  ): string | Stream.Readable {
    const stringify = this.json.stringify;
    if (stringify !== defaultJSONHandling.stringify) {
      // A custom serializer can change values or the document structure.
      // Send its output to the server with the original format.
      if (isStream(values)) {
        if (!values.readableObjectMode) return values;
        return Stream.pipeline(
          values,
          mapStream((row) => encodeJSON(row, format, stringify)),
          () => undefined,
        );
      }
      if (Array.isArray(values)) {
        return values.map((row) => encodeJSON(row, format, stringify)).join("");
      }
      return encodeJSON(values, format, stringify);
    }
    if (isStream(values)) {
      return values;
    }
    if (Array.isArray(values)) {
      return Stream.Readable.from(values, { objectMode: true });
    }
    if (typeof values === "object" && values !== null) {
      if (format === "JSONObjectEachRow") {
        return Stream.Readable.from(Object.values(values), {
          objectMode: true,
        });
      }
      const data = (values as { data?: unknown }).data;
      if (Array.isArray(data)) {
        // The JSON format: { meta, data }
        return Stream.Readable.from(data, { objectMode: true });
      }
    }
    throw new Error(
      `Cannot encode values of type ${typeof values} with ${format} format`,
    );
  }

  validateInsertValues<T>(
    values: InsertValues<Stream.Readable, T>,
    format: DataFormat,
  ): void {
    if (
      !Array.isArray(values) &&
      !isStream(values) &&
      typeof values !== "object"
    ) {
      throw new Error(
        'Insert expected "values" to be an array, a stream of values or a JSON object, ' +
          `got: ${typeof values}`,
      );
    }
    if (isStream(values)) {
      if (isSupportedRawFormat(format)) {
        if (values.readableObjectMode) {
          throw new Error(
            `Insert for ${format} expected Readable Stream with disabled object mode.`,
          );
        }
      } else if (!values.readableObjectMode) {
        throw new Error(
          `Insert for ${format} expected Readable Stream with enabled object mode.`,
        );
      }
    }
  }
}
