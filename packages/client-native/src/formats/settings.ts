import type { DataFormat } from "../common/index";
import type { DateTimeOutputFormat } from "../protocol/text";

/**
 * The server sends the result of a query in `Native` blocks. The HTTP
 * interface returns the result in a text format, for example `JSONEachRow`.
 * `OutputEncoder` writes the decoded blocks in the format that the caller
 * asked for, following the output settings below.
 */
export const SupportedNativeFormats = [
  "JSON",
  "JSONStrings",
  "JSONCompact",
  "JSONCompactStrings",
  "JSONColumnsWithMetadata",
  "JSONObjectEachRow",
  "JSONEachRow",
  "JSONStringsEachRow",
  "JSONCompactEachRow",
  "JSONCompactStringsEachRow",
  "JSONCompactEachRowWithNames",
  "JSONCompactEachRowWithNamesAndTypes",
  "JSONCompactStringsEachRowWithNames",
  "JSONCompactStringsEachRowWithNamesAndTypes",
  "JSONEachRowWithProgress",
  "CSV",
  "CSVWithNames",
  "CSVWithNamesAndTypes",
  "TabSeparated",
  "TabSeparatedRaw",
  "TabSeparatedWithNames",
  "TabSeparatedWithNamesAndTypes",
] as const satisfies readonly DataFormat[];

export function isSupportedNativeFormat(format: string): boolean {
  return (SupportedNativeFormats as readonly string[]).includes(format);
}

/** The server settings that change the text of the values. The client reads
 *  them from the server (see `system.settings`) and from the settings of the
 *  query, because their defaults depend on the server version. */
export interface OutputSettings {
  output_format_json_quote_64bit_integers: boolean;
  output_format_json_quote_64bit_floats: boolean;
  output_format_json_quote_decimals: boolean;
  output_format_json_quote_denormals: boolean;
  output_format_json_escape_forward_slashes: boolean;
  output_format_json_named_tuples_as_objects: boolean;
  output_format_json_skip_null_value_in_named_tuples: boolean;
  output_format_json_map_as_array_of_tuples: boolean;
  /** The `JSON` format writes nested values on more than one line. */
  output_format_json_pretty_print: boolean;
  /** `JSONEachRow` and `JSONStringsEachRow` write one JSON array of rows. */
  output_format_json_array_of_rows: boolean;
  /** Replace bytes that are not UTF-8 with U+FFFD in the JSON formats. The
   *  formats that write one JSON document always do this. */
  output_format_json_validate_utf8: boolean;
  /** The formats that write one JSON document show the statistics. */
  output_format_write_statistics: boolean;
  output_format_decimal_trailing_zeros: boolean;
  output_format_csv_crlf_end_of_line: boolean;
  output_format_tsv_crlf_end_of_line: boolean;
  output_format_csv_serialize_tuple_into_separate_columns: boolean;
  output_format_csv_header_serialize_tuple_into_separate_columns: boolean;
  format_csv_delimiter: string;
  format_csv_null_representation: string;
  format_tsv_null_representation: string;
  format_json_object_each_row_column_for_object_name: string;
  bool_true_representation: string;
  bool_false_representation: string;
  /** The text of `DateTime` and `DateTime64` values. The decoder of the
   *  columns uses it (see `formatDateTime`). */
  date_time_output_format: DateTimeOutputFormat;
  /** `DateTime64` text without zeros at the end of the fraction, with 3, 6
   *  or 9 digits (the `simple` text only). The decoder of the columns uses
   *  it (see `formatDateTime64`). */
  date_time_64_output_format_cut_trailing_zeros_align_to_groups_of_thousands: boolean;
  /** The text of the `Interval*` values: `numeric` or `kusto`. */
  interval_output_format: string;
}

/** The defaults of a recent server. The client uses these when it cannot
 *  read the settings from the server. */
export const DefaultOutputSettings: OutputSettings = {
  output_format_json_quote_64bit_integers: false,
  output_format_json_quote_64bit_floats: false,
  output_format_json_quote_decimals: false,
  output_format_json_quote_denormals: false,
  output_format_json_escape_forward_slashes: true,
  output_format_json_named_tuples_as_objects: true,
  output_format_json_skip_null_value_in_named_tuples: false,
  output_format_json_map_as_array_of_tuples: false,
  output_format_json_pretty_print: true,
  output_format_json_array_of_rows: false,
  output_format_json_validate_utf8: false,
  output_format_write_statistics: true,
  output_format_decimal_trailing_zeros: false,
  output_format_csv_crlf_end_of_line: false,
  output_format_tsv_crlf_end_of_line: false,
  output_format_csv_serialize_tuple_into_separate_columns: true,
  output_format_csv_header_serialize_tuple_into_separate_columns: true,
  format_csv_delimiter: ",",
  format_csv_null_representation: "\\N",
  format_tsv_null_representation: "\\N",
  format_json_object_each_row_column_for_object_name: "",
  bool_true_representation: "true",
  bool_false_representation: "false",
  date_time_output_format: "simple",
  date_time_64_output_format_cut_trailing_zeros_align_to_groups_of_thousands: false,
  interval_output_format: "numeric",
};

export const OutputSettingNames = Object.keys(DefaultOutputSettings) as Array<
  keyof OutputSettings
>;

/** Applies setting values (as strings) to the output settings. */
export function applyOutputSettings(
  base: OutputSettings,
  values: Record<string, unknown>,
): OutputSettings {
  const result: OutputSettings = { ...base };
  const target = result as unknown as Record<string, unknown>;
  for (const name of OutputSettingNames) {
    const value = values[name];
    if (value === undefined || value === null) continue;
    if (typeof DefaultOutputSettings[name] === "boolean") {
      const s = String(value).toLowerCase();
      target[name] = s === "1" || s === "true";
    } else {
      target[name] = String(value);
    }
  }
  return result;
}

/** Query statistics for the formats that show them. */
export interface OutputStatistics {
  elapsed_ns: number | bigint;
  rows_read: number | bigint;
  bytes_read: number | bigint;
  rows_before_limit_at_least: number | bigint | undefined;
}
