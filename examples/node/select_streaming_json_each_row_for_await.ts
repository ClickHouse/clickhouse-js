import { createClient, type Row } from '@clickhouse/client' // or '@clickhouse/client-web'

/**
 * Similar to `select_streaming_text_line_by_line.ts`, but using `for await const` syntax instead of `on(data)`.
 *
 * NB (Node.js platform): `for await const` has some overhead (up to 2 times worse) vs the old-school `on(data)` approach.
 * See the related Node.js issue: https://github.com/nodejs/node/issues/31979
 */
void (async () => {
  const client = createClient()
  const rs = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 10',
    // See all supported formats for streaming:
    // https://clickhouse.com/docs/en/integrations/language-clients/javascript#supported-data-formats
    format: 'JSONEachRow',
  })
  for await (const rows of rs.stream()) {
    rows.forEach((row: Row) => {
      console.log(row.json())
    })
  }
  console.log('Completed!')
  await client.close()
})()
