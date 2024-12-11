import { createClient, TupleParam } from '@clickhouse/client' // or '@clickhouse/client-web'

void (async () => {
  const client = createClient()
  const resultSet = await client.query({
    query: `
      SELECT
        {var_int: Int32}                     AS var_int,
        {var_float: Float32}                 AS var_float,
        {var_str: String}                    AS var_str,
        {var_array: Array(Int32)}            AS var_arr,
        {var_tuple: Tuple(Int32, String)}    AS var_tuple,
        {var_map: Map(Int, Array(String))}   AS var_map,
        {var_date: Date}                     AS var_date,
        {var_datetime: DateTime}             AS var_datetime,
        {var_datetime64_3: DateTime64(3)}    AS var_datetime64_3,
        {var_datetime64_9: DateTime64(9)}    AS var_datetime64_9,
        {var_datetime64_9_ts: DateTime64(9)} AS var_datetime64_9_ts,
        {var_decimal: Decimal(9, 2)}         AS var_decimal,
        {var_uuid: UUID}                     AS var_uuid,
        {var_ipv4: IPv4}                     AS var_ipv4,
        {var_null: Nullable(String)}         AS var_null
    `,
    format: 'JSONEachRow',
    query_params: {
      var_int: 10,
      var_float: '10.557',
      var_str: 20,
      var_array: [42, 144],
      var_tuple: new TupleParam([42, 'foo']),
      var_map: new Map([
        [42, ['a', 'b']],
        [144, ['c', 'd']],
      ]),
      var_date: '2022-01-01',
      var_datetime: '2022-01-01 12:34:56', // or a Date object
      var_datetime64_3: '2022-01-01 12:34:56.789', // or a Date object
      // NB: Date object with DateTime64(9) is still possible,
      // but there will be precision loss, as JS Date has only milliseconds.
      var_datetime64_9: '2022-01-01 12:34:56.123456789',
      // It is also possible to provide DateTime64 as a timestamp.
      var_datetime64_9_ts: '1651490755.123456789',
      var_decimal: '123.45',
      var_uuid: '01234567-89ab-cdef-0123-456789abcdef',
      var_ipv4: '192.168.0.1',
      var_null: null,
    },
  })
  console.info('Result (different data types):', await resultSet.json())

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
