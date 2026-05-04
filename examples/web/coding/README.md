# Web coding examples (`@clickhouse/client-web`)

This folder is the **day-to-day API usage** corpus for Web-focused coding
agents and developers.

## How to run

From `examples/web`:

```bash
npx tsx --transpile-only coding/select_json_each_row.ts
```

Run the whole examples suite:

```bash
npm run run-examples
```

## Quick example picker

- Connection and setup:
  - `url_configuration.ts`
  - `clickhouse_settings.ts`
  - `default_format_setting.ts`
- Ping and connectivity:
  - `ping_existing_host.ts`
  - `ping_non_existing_host.ts`
- Insert patterns:
  - `insert_data_formats_overview.ts`
  - `insert_specific_columns.ts`
  - `insert_exclude_columns.ts`
  - `insert_ephemeral_columns.ts`
  - `insert_values_and_functions.ts`
  - `insert_js_dates.ts`
  - `insert_decimals.ts`
  - `insert_into_different_db.ts`
  - `insert_from_select.ts`
  - `async_insert.ts`
- Select patterns:
  - `select_json_each_row.ts`
  - `select_json_with_metadata.ts`
  - `select_data_formats_overview.ts`
- Sessions and parameters:
  - `query_with_parameter_binding.ts`
  - `query_with_parameter_binding_special_chars.ts`
  - `session_id_and_temporary_tables.ts`
  - `session_level_commands.ts`
- Data type-focused examples:
  - `array_json_each_row.ts`
  - `dynamic_variant_json.ts`
  - `time_time64.ts`
  - `custom_json_handling.ts`

## Notes for AI-agent-friendly edits

- Keep examples runnable as standalone scripts.
- Use Web APIs only (no Node.js built-ins in this folder).
- Prefer explicit “See also” links to related examples.
- If you edit a duplicated coding example, update all listed duplicates in
  `examples/README.md#editing-duplicated-examples`.
