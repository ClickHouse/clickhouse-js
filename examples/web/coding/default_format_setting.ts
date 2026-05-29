import { createClient, ResultSet } from '@clickhouse/client-web'

// Using the `default_format` ClickHouse setting with `client.exec` so that the query
// does not need an explicit `FORMAT` clause and the response can be wrapped in a
// `ResultSet` for typed parsing. Useful when issuing arbitrary SQL via `exec`.
const client = createClient()
const format = 'JSONCompactEachRowWithNamesAndTypes'
const { stream, query_id } = await client.exec({
  // this query fails without `default_format` setting
  // as it does not have the FORMAT clause
  query: `SELECT database, name, engine FROM system.tables LIMIT 5`,
  clickhouse_settings: {
    default_format: format,
  },
})
const rs = new ResultSet(stream, format, query_id)
console.log(await rs.json())
await client.close()
