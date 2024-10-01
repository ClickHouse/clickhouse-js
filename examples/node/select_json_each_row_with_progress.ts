import { createClient } from '@clickhouse/client'
import { isProgress } from '@clickhouse/client-common'

/** See the format spec - https://clickhouse.com/docs/en/interfaces/formats#jsoneachrowwithprogress
 *  When JSONEachRowWithProgress format is used in TypeScript,
 *  the ResultSet should infer the final row type as `{ row: Data } | Progress`. */
type Data = { number: string }

void (async () => {
  const client = createClient()
  const rs = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 100',
    format: 'JSONEachRowWithProgress',
  })

  let totalRows = 0
  let totalProgressRows = 0

  const stream = rs.stream<Data>()
  for await (const rows of stream) {
    for (const row of rows) {
      const decodedRow = row.json()
      if (isProgress(decodedRow)) {
        console.log('Got a progress row:', decodedRow)
        totalProgressRows++
      } else {
        totalRows++
        if (totalRows % 100 === 0) {
          console.log('Sample row:', decodedRow)
        }
      }
    }
  }

  console.log('Total rows:', totalRows)
  console.log('Total progress rows:', totalProgressRows)

  await client.close()
})()
