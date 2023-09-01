import { createClient, ResultSet } from '@clickhouse/client' // or '@clickhouse/client-web'

void (async () => {
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
})()
