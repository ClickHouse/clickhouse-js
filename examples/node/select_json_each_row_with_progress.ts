import { createClient, isProgressRow, type Progress } from '@clickhouse/client'

/** See the format spec - https://clickhouse.com/docs/en/interfaces/formats#jsoneachrowwithprogress */
type Row = {
  row: { number: string }
}
type Data = Row | Progress

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
      if (isProgressRow(decodedRow)) {
        console.log('Got a progress row:', decodedRow)
        totalProgressRows++
      } else {
        totalRows++
      }
    }
  }

  console.log('Total rows:', totalRows)
  console.log('Total progress rows:', totalProgressRows)

  await client.close()
})()
