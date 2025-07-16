import { createClient, type ResultSet } from '@clickhouse/client'
import { isProgressRow, parseError } from '@clickhouse/client-common'
import {
  isException,
  isRow,
} from '@clickhouse/client-common/src/clickhouse_types'

/** A few use cases of the `JSONEachRowWithProgress` format with ClickHouse and the Node.js/TypeScript client.
 *  Here, the ResultSet infers the final row type as `{ row: T } | ProgressRow | SpecialEventRow<T>`. */
void (async () => {
  const client = createClient()

  const selectResultSet = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 3',
    format: 'JSONEachRowWithProgress',
    clickhouse_settings: {
      // in this example, we reduce the block size to 1 to see progress rows more frequently
      max_block_size: '1',
    },
  })
  await processResultSet<{ number: string }>(
    'A simple select query',
    selectResultSet,
  )
  printLine()

  const aggregationResultSet = await client.query({
    query: `
      SELECT
        (123 + number * 456) % 100  AS k,
        count()                     AS c,
        sum(number)                 AS s
      FROM numbers(100)
      GROUP BY ALL
      -- enables 'totals' special event row
      WITH TOTALS
      ORDER BY ALL
      LIMIT 10
    `,
    format: 'JSONEachRowWithProgress',
    clickhouse_settings: {
      // enables 'rows_before_aggregation' special event row
      rows_before_aggregation: 1,
      // enables 'min' and 'max' special event rows
      extremes: 1,
    },
  })
  await processResultSet<{ k: number; c: string; s: string }>(
    'Aggregation result set with all kinds of special events',
    aggregationResultSet,
  )
  printLine()

  const exceptionResultSet = await client.query({
    query: `SELECT number, throwIf(number = 3, 'boom') AS foo FROM system.numbers`,
    format: 'JSONEachRowWithProgress',
    clickhouse_settings: {
      // in this example, we reduce the block size to 1 to see progress rows more frequently
      max_block_size: '1',
    },
  })
  await processResultSet<{ number: string; foo: 0 }>(
    'An exception in the middle of a stream',
    exceptionResultSet,
  )

  await client.close()
})()

async function processResultSet<T>(
  name: string,
  rs: ResultSet<'JSONEachRowWithProgress'>,
) {
  console.log('###', name)
  printLine()

  let totalRows = 0
  let totalProgressRows = 0
  let totalSpecialEventRows = 0

  const stream = rs.stream<T>()
  for await (const rows of stream) {
    for (const row of rows) {
      const decodedRow = row.json()
      if (isProgressRow(decodedRow)) {
        console.log('Got a progress row:', decodedRow)
        totalProgressRows++
      } else if (isRow(decodedRow)) {
        totalRows++
        console.log('Got a row:', decodedRow)
      } else if (isException(decodedRow)) {
        console.error(
          'Got an exception row:',
          decodedRow,
          'which can be parsed as a ClickHouseError instance:\n',
          parseError(decodedRow.exception),
        )
      } else {
        totalSpecialEventRows++
        console.log('Got a special event row:', decodedRow)
      }
    }
  }

  printLine()
  console.log('Total rows:', totalRows)
  console.log('Total progress rows:', totalProgressRows)
  console.log('Total special event rows:', totalSpecialEventRows)
}

function printLine() {
  console.log('-------------')
}
