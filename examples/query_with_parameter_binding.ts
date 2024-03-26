import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

void (async () => {
  const client = createClient()
  const resultSet = await client.query({
    query: 'SELECT plus({val1: Int32}, {val2: Int32}) AS result',
    format: 'CSV',
    query_params: {
      val1: 10,
      val2: 20,
    },
  })
  console.info('Result (val1 + val2):', await resultSet.text())

  // (0.3.1+) It is also possible to bind parameters with special characters.
  const resultSet2 = await client.query({
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
  console.info('Result (special characters):', await resultSet2.json())

  await client.close()
})()
