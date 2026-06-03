import { createClient } from '@clickhouse/client'

/**
 * Binding query parameters that contain special characters (tabs, newlines, quotes, backslashes, etc.).
 * Available since clickhouse-js 0.3.1.
 *
 * For an overview of binding regular values of various data types, see `query_with_parameter_binding.ts`.
 */
const client = createClient()

const resultSet = await client.query({
  query: `
      SELECT
        'foo_\t_bar'  = {tab: String}             AS has_tab,
        'foo_\n_bar'  = {newline: String}         AS has_newline,
        'foo_\r_bar'  = {carriage_return: String} AS has_carriage_return,
        'foo_\\'_bar' = {single_quote: String}    AS has_single_quote,
        'foo_\\_bar'  = {backslash: String}       AS has_backslash`,
  format: 'JSONEachRow',
  query_params: {
    tab: 'foo_\t_bar',
    newline: 'foo_\n_bar',
    carriage_return: 'foo_\r_bar',
    single_quote: "foo_'_bar",
    backslash: 'foo_\\_bar',
  },
})

// Should return all 1, as query params will match the strings in the SELECT.
console.info('Result (special characters):', await resultSet.json())

await client.close()
