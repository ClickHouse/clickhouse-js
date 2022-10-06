import { createClient } from '@clickhouse/client'
import type { Row } from '../src'

/**
 * NB: `for await const` has quite significant overhead
 * (up to 2 times worse) vs old school `on(data)` approach
 * for that example, see `select_streaming_on_data.ts`
 *
 * See also: https://github.com/nodejs/node/issues/31979
 */
void (async () => {
  const client = createClient()
  const rs = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 10',
    format: 'JSONEachRow',
  })
  for await (const rows of rs.stream()) {
    rows.forEach((row: Row) => {
      console.log(row.json())
    })
  }
  await client.close()
})()
