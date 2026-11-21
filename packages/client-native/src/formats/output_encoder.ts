import type { DataFormat } from "../common/index";
import { BinaryJSONRows } from "../json_rows";
import type { Block, Column, Progress } from "../protocol/packets";
import type { ColumnType } from "../protocol/types";
import { RawJSONValue, TypedValue } from "../protocol/columns";
import { tabs } from "./json_pretty";
import type { OutputSettings, OutputStatistics } from "./settings";
import { isSupportedNativeFormat, SupportedNativeFormats } from "./settings";
import {
  JSON_ESCAPE_BYTES,
  ValueWriter,
  canHaveLines,
  escapeText,
  passValue,
  setField,
} from "./value_writer";

const JSONSTRINGS_NULL = "ᴺᵁᴸᴸ";

/** The parts of a row that are the same for all rows of a block. */
interface PrettyColumns {
  /** The text before each value: the indent, the name and `: `. */
  prefixes: string[];
  /** The value of the column can be on more than one line. */
  multiLine: boolean[];
  /** The text after the last value. */
  end: string;
  /** The number of tabs before each field. */
  indent: number;
}

/** How a format writes its rows. */
type Layout =
  /** One JSON object on each line: `JSONEachRow`, `JSONStringsEachRow`. */
  | "object_lines"
  /** `JSONEachRowWithProgress`. */
  | "progress"
  /** One JSON array on each line: the `JSONCompact*EachRow*` formats. */
  | "array_lines"
  /** One JSON document with objects: `JSON`, `JSONStrings`. */
  | "document"
  /** One JSON document with arrays: `JSONCompact`, `JSONCompactStrings`. */
  | "compact_document"
  | "columns"
  | "object_each_row"
  | "csv"
  | "tsv";

function layoutOf(format: DataFormat): Layout {
  switch (format) {
    case "JSON":
    case "JSONStrings":
      return "document";
    case "JSONCompact":
    case "JSONCompactStrings":
      return "compact_document";
    case "JSONColumnsWithMetadata":
      return "columns";
    case "JSONObjectEachRow":
      return "object_each_row";
    case "JSONEachRow":
    case "JSONStringsEachRow":
      return "object_lines";
    case "JSONEachRowWithProgress":
      return "progress";
    case "CSV":
    case "CSVWithNames":
    case "CSVWithNamesAndTypes":
      return "csv";
    case "TabSeparated":
    case "TabSeparatedRaw":
    case "TabSeparatedWithNames":
    case "TabSeparatedWithNamesAndTypes":
      return "tsv";
    default:
      return "array_lines";
  }
}

/** Writes the blocks of one query in one output format. */
export class OutputEncoder {
  private readonly format: DataFormat;
  private readonly layout: Layout;
  private readonly settings: OutputSettings;
  private readonly values: ValueWriter;
  private binaryRows: BinaryJSONRows | undefined;
  private columns: Array<Pick<Column, "name" | "type">> | undefined;
  private rows = 0;
  private started = false;
  private totals: Block | undefined;
  private extremes: Block | undefined;
  /** JSONColumnsWithMetadata keeps all values until the end. */
  private columnValues: string[][] = [];
  private readonly isStrings: boolean;
  /** The rows are the elements of one JSON array
   *  (`output_format_json_array_of_rows`). */
  private readonly arrayOfRows: boolean;
  /** Nested values of a row are on more than one line. */
  private readonly prettyValues: boolean;
  private readonly eol: string;

  constructor(format: DataFormat, settings: OutputSettings) {
    if (!isSupportedNativeFormat(format)) {
      throw new Error(
        `The ${format} format is not supported by the native protocol client. ` +
          `Supported formats: ${SupportedNativeFormats.join(", ")}.`,
      );
    }
    this.format = format;
    this.layout = layoutOf(format);
    this.settings = settings;
    // The formats that write one JSON document always write valid UTF-8.
    const isDocument =
      this.layout === "document" ||
      this.layout === "compact_document" ||
      this.layout === "columns";
    this.values = new ValueWriter(
      settings,
      isDocument || settings.output_format_json_validate_utf8,
    );
    this.isStrings = format.includes("Strings");
    this.arrayOfRows =
      this.layout === "object_lines" &&
      settings.output_format_json_array_of_rows;
    this.prettyValues =
      !this.isStrings && settings.output_format_json_pretty_print;
    if (this.layout === "csv") {
      this.eol = settings.output_format_csv_crlf_end_of_line ? "\r\n" : "\n";
    } else if (this.layout === "tsv") {
      this.eol = settings.output_format_tsv_crlf_end_of_line ? "\r\n" : "\n";
    } else {
      this.eol = "\n";
    }
  }

  /** Handles a Data block. Returns the text to send, if any. */
  data(block: Block): string {
    if (block.columns.length === 0) return "";
    let out = "";
    if (this.columns === undefined) {
      this.columns = block.columns.map(({ name, type }) => ({ name, type }));
      this.columnValues = this.columns.map(() => []);
      out += this.header();
    }
    if (block.rows > 0) out += this.writeRows(block);
    return out;
  }

  /** True if the format has {@link dataRows}. */
  get hasDataRows(): boolean {
    if (this.isStrings || this.arrayOfRows) return false;
    return (
      this.layout === "object_lines" ||
      this.layout === "array_lines" ||
      this.layout === "document" ||
      this.layout === "compact_document"
    );
  }

  /** These formats can write simple rows straight from the Native block. */
  get canWriteBinaryRows(): boolean {
    return (
      !this.isStrings &&
      !this.arrayOfRows &&
      (this.layout === "object_lines" || this.layout === "array_lines")
    );
  }

  /** Lazily formats a large binary block in sub-batches of `batchRows` rows
   *  for `ResultSet.stream()`, avoiding formatting all 65k rows before the
   *  consumer reads the first batch. Returns `undefined` when not applicable. */
  dataStream(
    block: Block,
    batchRows: number,
  ): (() => string | undefined) | undefined {
    if (
      block.columns.length === 0 ||
      block.rows <= batchRows ||
      !this.canWriteBinaryRows ||
      block.columns[0]?.binary === undefined
    ) {
      return undefined;
    }
    const writer = (this.binaryRows ??= new BinaryJSONRows(
      JSON_ESCAPE_BYTES,
      this.settings.output_format_json_escape_forward_slashes,
      this.settings.output_format_json_quote_64bit_integers,
    ));
    const prefixes =
      this.layout === "object_lines"
        ? this.objectPrefixes(block)
        : block.columns.map((_, i) => (i === 0 ? "[" : ", "));
    const suffix = this.layout === "object_lines" ? "}\n" : "]\n";
    const stepper = writer.open(block, prefixes, suffix);
    if (stepper === undefined) return undefined;
    let headerText = "";
    if (this.columns === undefined) {
      this.columns = block.columns.map(({ name, type }) => ({ name, type }));
      this.columnValues = this.columns.map(() => []);
      headerText = this.header();
    }
    this.rows += block.rows;
    let first = true;
    return () => {
      const part = stepper.next(batchRows);
      if (part === undefined) return undefined;
      if (first) {
        first = false;
        if (headerText.length > 0) return headerText + part;
      }
      return part;
    };
  }

  /**
   * Handles a Data block as {@link data} does, but gives its rows as JS
   * values: the values that `JSON.parse` gives for the text of the rows.
   * `text` is the text of the block without its rows (for example, the start
   * of the document of the `JSON` format). In the document formats, the
   * `rows` field of the document does not count these rows.
   *
   * @param raw The block can have strings with bytes that are not UTF-8.
   */
  dataRows(block: Block, raw: boolean): { rows: unknown[]; text: string } {
    const text = this.data({
      columns: block.columns.map(({ name, type }) => ({
        name,
        type,
        values: [],
      })),
      rows: 0,
    });
    const values = this.values;
    values.raw = raw;
    const columns = block.columns;
    const count = columns.length;
    const rowCount = block.rows;
    const data = new Array<unknown[]>(count);
    for (let c = 0; c < count; c++) {
      const column = columns[c]!;
      const rawCol = column.values;
      const fn = values.converter(column.type);
      if (fn === passValue) {
        data[c] = rawCol;
      } else if (
        !raw &&
        rowCount > 1 &&
        column.type.kind === "JSON" &&
        rawCol[0] instanceof RawJSONValue
      ) {
        const bulk = tryBulkParseRawJSON(rawCol, rowCount);
        if (bulk !== undefined) {
          data[c] = bulk;
        } else {
          const out = new Array<unknown>(rowCount);
          for (let r = 0; r < rowCount; r++) out[r] = fn(rawCol[r]);
          data[c] = out;
        }
      } else {
        const out = new Array<unknown>(rowCount);
        for (let r = 0; r < rowCount; r++) out[r] = fn(rawCol[r]);
        data[c] = out;
      }
    }
    const rows = new Array<unknown>(rowCount);
    if (this.layout === "array_lines" || this.layout === "compact_document") {
      for (let r = 0; r < rowCount; r++) {
        const row = new Array<unknown>(count);
        for (let c = 0; c < count; c++) {
          row[c] = data[c]![r] ?? null;
        }
        rows[r] = row;
      }
      return { rows, text };
    }
    const names = columns.map((column) => values.string(column.name));
    const plain = !names.includes("__proto__");
    if (plain) {
      buildPlainRowObjects(rows, rowCount, names, data, count);
    } else {
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, unknown> = {};
        for (let c = 0; c < count; c++) {
          setField(row, names[c] as string, data[c]![r] ?? null);
        }
        rows[r] = row;
      }
    }
    return { rows, text };
  }

  totalsBlock(block: Block): void {
    if (block.rows > 0) this.totals = block;
  }

  extremesBlock(block: Block): void {
    if (block.rows > 0) this.extremes = block;
  }

  progress(progress: Progress): string {
    if (this.format !== "JSONEachRowWithProgress") return "";
    return (
      `{"progress":{"read_rows":"${progress.read_rows}","read_bytes":"${progress.read_bytes}",` +
      `"total_rows_to_read":"${progress.total_rows_to_read}","elapsed_ns":"${progress.elapsed_ns}"}}\n`
    );
  }

  private header(): string {
    const columns = this.columns ?? [];
    const names = columns.map((c) => c.name);
    const types = columns.map((c) => c.type.name);
    const eol = this.eol;
    switch (this.format) {
      case "JSONCompactEachRowWithNames":
      case "JSONCompactStringsEachRowWithNames":
        return this.jsonArray(names) + "\n";
      case "JSONCompactEachRowWithNamesAndTypes":
      case "JSONCompactStringsEachRowWithNamesAndTypes":
        return this.jsonArray(names) + "\n" + this.jsonArray(types) + "\n";
      case "JSONEachRowWithProgress":
        return (
          '{"meta":[' +
          columns
            .map(
              (c) =>
                `{"name":${this.values.key(c.name)},"type":${this.values.key(c.type.name)}}`,
            )
            .join(",") +
          "]}\n"
        );
      case "CSVWithNames":
        return this.csvRow(this.csvColumns().map((c) => c[0])) + eol;
      case "CSVWithNamesAndTypes": {
        const csvColumns = this.csvColumns();
        return (
          this.csvRow(csvColumns.map((c) => c[0])) +
          eol +
          this.csvRow(csvColumns.map((c) => c[1])) +
          eol
        );
      }
      case "TabSeparatedWithNames":
        return names.map(escapeText).join("\t") + eol;
      case "TabSeparatedWithNamesAndTypes":
        return (
          names.map(escapeText).join("\t") +
          eol +
          types.map(escapeText).join("\t") +
          eol
        );
      case "JSON":
      case "JSONStrings":
      case "JSONCompact":
      case "JSONCompactStrings":
        return "{\n" + this.meta(columns) + ',\n\n\t"data":\n\t[\n';
      case "JSONObjectEachRow":
        return "{\n";
      case "JSONEachRow":
      case "JSONStringsEachRow":
        return this.arrayOfRows ? "[\n" : "";
      default:
        return "";
    }
  }

  /** The CSV columns of the header: a tuple becomes one column for each
   *  element, as the values do
   *  (`output_format_csv_serialize_tuple_into_separate_columns`). */
  private csvColumns(): Array<[name: string, type: string]> {
    const split =
      this.settings.output_format_csv_serialize_tuple_into_separate_columns &&
      this.settings
        .output_format_csv_header_serialize_tuple_into_separate_columns;
    const out: Array<[string, string]> = [];
    const add = (name: string, type: ColumnType) => {
      if (type.kind === "Tuple" && split && type.elements.length > 0) {
        type.elements.forEach((element, i) =>
          add(`${name}.${type.names?.[i] ?? i + 1}`, element),
        );
      } else {
        out.push([name, type.name]);
      }
    };
    for (const column of this.columns ?? []) add(column.name, column.type);
    return out;
  }

  private jsonArray(items: string[]): string {
    return "[" + items.map((item) => this.values.key(item)).join(", ") + "]";
  }

  private csvRow(items: string[]): string {
    return items.map(csvQuote).join(this.settings.format_csv_delimiter);
  }

  private writeRows(block: Block): string {
    const rows = block.rows;
    const first = this.rows;
    this.rows += rows;
    if (!this.isStrings) {
      if (this.layout === "object_lines" && !this.arrayOfRows) {
        return this.writeJSONLines(block, this.objectPrefixes(block), "}\n");
      }
      if (this.layout === "array_lines") {
        const prefixes = block.columns.map((_, i) => (i === 0 ? "[" : ", "));
        return this.writeJSONLines(block, prefixes, "]\n");
      }
    }
    const parts = new Array<string>(rows);
    switch (this.layout) {
      case "object_lines": {
        const prefixes = this.objectPrefixes(block);
        if (!this.arrayOfRows) {
          for (let row = 0; row < rows; row++) {
            parts[row] = this.objectRow(block, row, prefixes) + "\n";
          }
          break;
        }
        for (let row = 0; row < rows; row++) {
          parts[row] =
            (this.started ? ",\n" : "") + this.objectRow(block, row, prefixes);
          this.started = true;
        }
        break;
      }
      case "progress": {
        const prefixes = this.objectPrefixes(block);
        for (let row = 0; row < rows; row++) {
          parts[row] = '{"row":' + this.objectRow(block, row, prefixes) + "}\n";
        }
        break;
      }
      case "array_lines":
        for (let row = 0; row < rows; row++) {
          parts[row] = this.arrayRow(block, row) + "\n";
        }
        break;
      case "document": {
        const pretty = this.prettyColumns(block, 2, this.prettyValues);
        for (let row = 0; row < rows; row++) {
          parts[row] =
            (this.started ? ",\n" : "") +
            this.prettyObjectRow(block, row, pretty);
          this.started = true;
        }
        break;
      }
      case "compact_document":
        for (let row = 0; row < rows; row++) {
          parts[row] =
            (this.started ? ",\n\t\t" : "\t\t") + this.arrayRow(block, row);
          this.started = true;
        }
        break;
      case "object_each_row": {
        const nameColumn =
          this.settings.format_json_object_each_row_column_for_object_name;
        const named =
          nameColumn === ""
            ? undefined
            : block.columns.find((c) => c.name === nameColumn);
        const columns =
          named === undefined
            ? block.columns
            : block.columns.filter((c) => c !== named);
        const prefixes = this.objectPrefixes({ columns });
        for (let row = 0; row < rows; row++) {
          const name =
            named === undefined
              ? `row_${first + row + 1}`
              : this.values.text(named.type, named.values[row]);
          let body = columns.length === 0 ? "{" : "";
          for (let c = 0; c < columns.length; c++) {
            const column = columns[c] as Column;
            body +=
              (prefixes[c] as string) +
              this.values.json(column.type, column.values[row]);
          }
          parts[row] =
            (this.started ? ",\n\t" : "\t") +
            this.values.plainKey(name) +
            ": " +
            body +
            "}";
          this.started = true;
        }
        break;
      }
      case "columns":
        for (let c = 0; c < block.columns.length; c++) {
          const column = block.columns[c] as Column;
          const out = this.columnValues[c] as string[];
          for (let row = 0; row < rows; row++) {
            out.push(this.jsonValue(column.type, column.values[row]));
          }
        }
        return "";
      case "csv":
        for (let row = 0; row < rows; row++) {
          parts[row] = this.csvValues(block, row) + this.eol;
        }
        break;
      case "tsv":
        for (let row = 0; row < rows; row++) {
          parts[row] = this.tsvValues(block, row) + this.eol;
        }
        break;
    }
    return parts.join("");
  }

  /** Formats each column before joining the rows. The join reuses the
   *  first field's prefix as part of the separator between rows. */
  private writeJSONLines(
    block: Block,
    prefixes: string[],
    suffix: "}\n" | "]\n",
  ): string {
    const { columns, rows } = block;
    if (columns[0]?.binary !== undefined) {
      const writer = (this.binaryRows ??= new BinaryJSONRows(
        JSON_ESCAPE_BYTES,
        this.settings.output_format_json_escape_forward_slashes,
        this.settings.output_format_json_quote_64bit_integers,
      ));
      const text = writer.write(block, prefixes, suffix);
      if (text !== undefined) return text;
    }
    const parts = new Array<string>(rows);
    const { type: firstType, values: firstValues } = columns[0] as Column;
    const formatFirst = this.values.jsonFormatter(firstType);
    for (let row = 0; row < rows; row++)
      parts[row] = formatFirst(firstValues[row]);
    for (let c = 1; c < columns.length; c++) {
      const { type, values } = columns[c] as Column;
      const format = this.values.jsonFormatter(type);
      const prefix = prefixes[c] as string;
      for (let row = 0; row < rows; row++)
        parts[row] += prefix + format(values[row]);
    }
    const start = prefixes[0] as string;
    return start + parts.join(suffix + start) + suffix;
  }

  /** One value in a JSON format. */
  private jsonValue(type: ColumnType, value: unknown): string {
    if (!this.isStrings) return this.values.json(type, value);
    if (isNull(type, value)) return '"' + JSONSTRINGS_NULL + '"';
    return this.values.key(this.values.text(type, value));
  }

  /** The text before each value of a JSON object row: `{"a":`, `,"b":`. */
  private objectPrefixes(block: Pick<Block, "columns">): string[] {
    return block.columns.map(
      (column, i) => (i === 0 ? "{" : ",") + this.values.key(column.name) + ":",
    );
  }

  private objectRow(block: Block, row: number, prefixes: string[]): string {
    const columns = block.columns;
    let out = columns.length === 0 ? "{" : "";
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c] as Column;
      out +=
        (prefixes[c] as string) +
        this.jsonValue(column.type, column.values[row]);
    }
    return out + "}";
  }

  private arrayRow(block: Block, row: number): string {
    const columns = block.columns;
    let out = "[";
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c] as Column;
      if (c > 0) out += ", ";
      out += this.jsonValue(column.type, column.values[row]);
    }
    return out + "]";
  }

  /** Prepares the rows of a block as JSON objects with one field on each
   *  line. `indent` is the number of tabs before the braces. */
  private prettyColumns(
    block: Block,
    indent: number,
    prettyValues: boolean,
  ): PrettyColumns {
    const outer = tabs(indent);
    const inner = tabs(indent + 1);
    return {
      prefixes: block.columns.map(
        (column, i) =>
          (i === 0 ? outer + "{\n" : ",\n") +
          inner +
          this.values.key(column.name) +
          ": ",
      ),
      multiLine: block.columns.map(
        (column) => prettyValues && canHaveLines(column.type),
      ),
      end: "\n" + outer + "}",
      indent: indent + 1,
    };
  }

  private prettyObjectRow(
    block: Block,
    row: number,
    pretty: PrettyColumns,
  ): string {
    const columns = block.columns;
    let out = columns.length === 0 ? tabs(pretty.indent - 1) + "{\n" : "";
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c] as Column;
      const value = column.values[row];
      out +=
        (pretty.prefixes[c] as string) +
        (pretty.multiLine[c]
          ? this.values.pretty(column.type, value, pretty.indent)
          : this.jsonValue(column.type, value));
    }
    return out + pretty.end;
  }

  private csvValues(block: Block, row: number): string {
    const fields: string[] = [];
    for (const column of block.columns) {
      this.csvField(column.type, column.values[row], fields);
    }
    return fields.join(this.settings.format_csv_delimiter);
  }

  private csvField(type: ColumnType, value: unknown, fields: string[]): void {
    if (
      (type.kind === "Variant" || type.kind === "Dynamic") &&
      value instanceof TypedValue
    ) {
      this.csvField(value.type, value.value, fields);
      return;
    }
    if (
      type.kind === "Tuple" &&
      this.settings.output_format_csv_serialize_tuple_into_separate_columns
    ) {
      // The elements are separate fields. A tuple in Nullable is one field,
      // as all other nested values. An empty tuple is one empty field.
      if (type.elements.length === 0) fields.push("");
      type.elements.forEach((element, i) =>
        this.csvField(element, (value as unknown[])[i], fields),
      );
      return;
    }
    if (isNull(type, value)) {
      fields.push(this.settings.format_csv_null_representation);
      return;
    }
    const text = this.values.text(type, value);
    fields.push(
      this.values.isNumeric(unwrapValueType(type, value))
        ? text
        : csvQuote(text),
    );
  }

  private tsvValues(block: Block, row: number): string {
    const raw = this.format === "TabSeparatedRaw";
    const columns = block.columns;
    let out = "";
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c] as Column;
      const value = column.values[row];
      if (c > 0) out += "\t";
      if (isNull(column.type, value)) {
        out += this.settings.format_tsv_null_representation;
        continue;
      }
      const text = this.values.text(column.type, value);
      const base = unwrapValueType(column.type, value);
      // Nested values are already in the quoted form.
      const nested =
        base.kind === "Array" || base.kind === "Tuple" || base.kind === "Map";
      out += raw || nested ? text : escapeText(text);
    }
    return out;
  }

  /** The text after the last block. */
  finish(stats: OutputStatistics): string {
    this.releaseBinaryBuffer();
    const columns = this.columns ?? [];
    switch (this.layout) {
      case "document":
      case "compact_document": {
        let out = this.columns === undefined ? this.header() : "";
        out += "\n\t]";
        const compact = this.layout === "compact_document";
        if (this.totals !== undefined) {
          out += compact
            ? ',\n\n\t"totals": ' + this.arrayRow(this.totals, 0)
            : ',\n\n\t"totals":\n' + this.prettyBlockRow(this.totals, 0, 1);
        }
        if (this.extremes !== undefined && this.extremes.rows >= 2) {
          out += compact
            ? ',\n\n\t"extremes":\n\t{\n\t\t"min": ' +
              this.arrayRow(this.extremes, 0) +
              ',\n\t\t"max": ' +
              this.arrayRow(this.extremes, 1) +
              "\n\t}"
            : this.prettyExtremes(this.extremes);
        }
        out += ',\n\n\t"rows": ' + this.rows;
        out += this.statistics(stats);
        return out + "\n}\n";
      }
      case "columns": {
        let out = "{\n" + this.meta(columns) + ',\n\n\t"data":\n\t{\n';
        if (this.rows > 0) {
          out += columns
            .map(
              (c, i) =>
                "\t\t" +
                this.values.key(c.name) +
                ": [" +
                (this.columnValues[i] as string[]).join(", ") +
                "]",
            )
            .join(",\n");
        }
        out += "\n\t}";
        if (this.totals !== undefined) {
          out += ',\n\n\t"totals":\n' + this.prettyBlockRow(this.totals, 0, 1);
        }
        if (this.extremes !== undefined && this.extremes.rows >= 2) {
          out += this.prettyExtremes(this.extremes);
        }
        out += ',\n\n\t"rows": ' + this.rows;
        out += this.statistics(stats);
        return out + "\n}\n";
      }
      case "object_each_row":
        return (this.columns === undefined ? "{\n" : "") + "\n}\n";
      case "object_lines":
        if (!this.arrayOfRows) return "";
        return (this.columns === undefined ? "[\n" : "") + "\n]\n";
      case "progress": {
        let out = "";
        if (this.totals !== undefined) {
          out +=
            '{"totals":' +
            this.objectRow(this.totals, 0, this.objectPrefixes(this.totals)) +
            "}\n";
        }
        if (this.extremes !== undefined && this.extremes.rows >= 2) {
          const prefixes = this.objectPrefixes(this.extremes);
          out += '{"min":' + this.objectRow(this.extremes, 0, prefixes) + "}\n";
          out += '{"max":' + this.objectRow(this.extremes, 1, prefixes) + "}\n";
        }
        if (stats.rows_before_limit_at_least !== undefined) {
          out += `{"rows_before_limit_at_least":${stats.rows_before_limit_at_least}}\n`;
        }
        return out;
      }
      case "csv":
      case "tsv": {
        let out = "";
        if (this.totals !== undefined) {
          out += this.eol + this.textRow(this.totals, 0) + this.eol;
        }
        if (this.extremes !== undefined && this.extremes.rows >= 2) {
          out +=
            this.eol +
            this.textRow(this.extremes, 0) +
            this.eol +
            this.textRow(this.extremes, 1) +
            this.eol;
        }
        return out;
      }
      default:
        return "";
    }
  }

  releaseBinaryBuffer(): void {
    this.binaryRows = undefined;
  }

  private textRow(block: Block, row: number): string {
    return this.layout === "csv"
      ? this.csvValues(block, row)
      : this.tsvValues(block, row);
  }

  /** A row of the totals or the extremes: one field on each line. Each
   *  value is on one line. */
  private prettyBlockRow(block: Block, row: number, indent: number): string {
    return this.prettyObjectRow(
      block,
      row,
      this.prettyColumns(block, indent, false),
    );
  }

  private prettyExtremes(extremes: Block): string {
    return (
      ',\n\n\t"extremes":\n\t{\n\t\t"min":\n' +
      this.prettyBlockRow(extremes, 0, 2) +
      ',\n\t\t"max":\n' +
      this.prettyBlockRow(extremes, 1, 2) +
      "\n\t}"
    );
  }

  private meta(columns: Array<Pick<Column, "name" | "type">>): string {
    return (
      '\t"meta":\n\t[\n' +
      columns
        .map(
          (c) =>
            '\t\t{\n\t\t\t"name": ' +
            this.values.key(c.name) +
            ',\n\t\t\t"type": ' +
            this.values.key(c.type.name) +
            "\n\t\t}",
        )
        .join(",\n") +
      "\n\t]"
    );
  }

  private statistics(stats: OutputStatistics): string {
    let out = "";
    if (stats.rows_before_limit_at_least !== undefined) {
      out +=
        ',\n\n\t"rows_before_limit_at_least": ' +
        stats.rows_before_limit_at_least;
    }
    if (this.settings.output_format_write_statistics) {
      out +=
        ',\n\n\t"statistics":\n\t{\n\t\t"elapsed": ' +
        Number(stats.elapsed_ns) / 1e9 +
        ',\n\t\t"rows_read": ' +
        stats.rows_read +
        ',\n\t\t"bytes_read": ' +
        stats.bytes_read +
        "\n\t}";
    }
    return out;
  }
}

function isNull(type: ColumnType, value: unknown): boolean {
  return (value === null || value === undefined) && type.kind !== "JSON";
}

/** The type of a value, through Nullable, LowCardinality, Variant and Dynamic. */
function unwrapValueType(type: ColumnType, value: unknown): ColumnType {
  let t = type;
  for (;;) {
    if (t.kind === "Nullable" || t.kind === "LowCardinality") {
      t = t.inner;
    } else if (
      (t.kind === "Variant" || t.kind === "Dynamic") &&
      value instanceof TypedValue
    ) {
      t = value.type;
      value = value.value;
    } else {
      return t;
    }
  }
}

function csvQuote(s: string): string {
  return '"' + s.replace(/"/g, '""') + '"';
}

function tryBulkParseRawJSON(
  rawCol: unknown[],
  rowCount: number,
): unknown[] | undefined {
  const texts = new Array<string>(rowCount);
  for (let r = 0; r < rowCount; r++) {
    const v = rawCol[r];
    if (!(v instanceof RawJSONValue)) return undefined;
    texts[r] = v.text;
  }
  try {
    const parsed = JSON.parse("[" + texts.join(",") + "]") as unknown[];
    return parsed.length === rowCount ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Populates plain row objects (`!names.includes("__proto__")`) with unrolled
 *  property-assignment sites for 1..8 columns so each column gets its own
 *  monomorphic V8 inline cache. */
function buildPlainRowObjects(
  rows: unknown[],
  rowCount: number,
  names: string[],
  data: unknown[][],
  count: number,
): void {
  switch (count) {
    case 1: {
      const n0 = names[0]!;
      const c0 = data[0]!;
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, unknown> = {};
        row[n0] = c0[r] ?? null;
        rows[r] = row;
      }
      return;
    }
    case 2: {
      const n0 = names[0]!;
      const n1 = names[1]!;
      const c0 = data[0]!;
      const c1 = data[1]!;
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, unknown> = {};
        row[n0] = c0[r] ?? null;
        row[n1] = c1[r] ?? null;
        rows[r] = row;
      }
      return;
    }
    case 3: {
      const n0 = names[0]!;
      const n1 = names[1]!;
      const n2 = names[2]!;
      const c0 = data[0]!;
      const c1 = data[1]!;
      const c2 = data[2]!;
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, unknown> = {};
        row[n0] = c0[r] ?? null;
        row[n1] = c1[r] ?? null;
        row[n2] = c2[r] ?? null;
        rows[r] = row;
      }
      return;
    }
    case 4: {
      const n0 = names[0]!;
      const n1 = names[1]!;
      const n2 = names[2]!;
      const n3 = names[3]!;
      const c0 = data[0]!;
      const c1 = data[1]!;
      const c2 = data[2]!;
      const c3 = data[3]!;
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, unknown> = {};
        row[n0] = c0[r] ?? null;
        row[n1] = c1[r] ?? null;
        row[n2] = c2[r] ?? null;
        row[n3] = c3[r] ?? null;
        rows[r] = row;
      }
      return;
    }
    case 5: {
      const n0 = names[0]!;
      const n1 = names[1]!;
      const n2 = names[2]!;
      const n3 = names[3]!;
      const n4 = names[4]!;
      const c0 = data[0]!;
      const c1 = data[1]!;
      const c2 = data[2]!;
      const c3 = data[3]!;
      const c4 = data[4]!;
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, unknown> = {};
        row[n0] = c0[r] ?? null;
        row[n1] = c1[r] ?? null;
        row[n2] = c2[r] ?? null;
        row[n3] = c3[r] ?? null;
        row[n4] = c4[r] ?? null;
        rows[r] = row;
      }
      return;
    }
    case 6: {
      const n0 = names[0]!;
      const n1 = names[1]!;
      const n2 = names[2]!;
      const n3 = names[3]!;
      const n4 = names[4]!;
      const n5 = names[5]!;
      const c0 = data[0]!;
      const c1 = data[1]!;
      const c2 = data[2]!;
      const c3 = data[3]!;
      const c4 = data[4]!;
      const c5 = data[5]!;
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, unknown> = {};
        row[n0] = c0[r] ?? null;
        row[n1] = c1[r] ?? null;
        row[n2] = c2[r] ?? null;
        row[n3] = c3[r] ?? null;
        row[n4] = c4[r] ?? null;
        row[n5] = c5[r] ?? null;
        rows[r] = row;
      }
      return;
    }
    case 7: {
      const n0 = names[0]!;
      const n1 = names[1]!;
      const n2 = names[2]!;
      const n3 = names[3]!;
      const n4 = names[4]!;
      const n5 = names[5]!;
      const n6 = names[6]!;
      const c0 = data[0]!;
      const c1 = data[1]!;
      const c2 = data[2]!;
      const c3 = data[3]!;
      const c4 = data[4]!;
      const c5 = data[5]!;
      const c6 = data[6]!;
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, unknown> = {};
        row[n0] = c0[r] ?? null;
        row[n1] = c1[r] ?? null;
        row[n2] = c2[r] ?? null;
        row[n3] = c3[r] ?? null;
        row[n4] = c4[r] ?? null;
        row[n5] = c5[r] ?? null;
        row[n6] = c6[r] ?? null;
        rows[r] = row;
      }
      return;
    }
    case 8: {
      const n0 = names[0]!;
      const n1 = names[1]!;
      const n2 = names[2]!;
      const n3 = names[3]!;
      const n4 = names[4]!;
      const n5 = names[5]!;
      const n6 = names[6]!;
      const n7 = names[7]!;
      const c0 = data[0]!;
      const c1 = data[1]!;
      const c2 = data[2]!;
      const c3 = data[3]!;
      const c4 = data[4]!;
      const c5 = data[5]!;
      const c6 = data[6]!;
      const c7 = data[7]!;
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, unknown> = {};
        row[n0] = c0[r] ?? null;
        row[n1] = c1[r] ?? null;
        row[n2] = c2[r] ?? null;
        row[n3] = c3[r] ?? null;
        row[n4] = c4[r] ?? null;
        row[n5] = c5[r] ?? null;
        row[n6] = c6[r] ?? null;
        row[n7] = c7[r] ?? null;
        rows[r] = row;
      }
      return;
    }
    default:
      for (let r = 0; r < rowCount; r++) {
        const row: Record<string, unknown> = {};
        for (let c = 0; c < count; c++) {
          row[names[c] as string] = data[c]![r] ?? null;
        }
        rows[r] = row;
      }
  }
}
