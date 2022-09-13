import Stream from 'stream'
import { createClient } from '../../src'
import { v4 as uuid_v4 } from 'uuid'
import { randomInt } from 'crypto'
import {
  attachExceptionHandlers,
  getMemoryUsageInMegabytes,
  logFinalMemoryUsage,
  logMemoryUsageOnIteration,
  logMemoryUsage,
} from './shared'

const program = async () => {
  const client = createClient({})
  const tableName = `memory_leak_random_integers_${uuid_v4().replace(/-/g, '')}`

  await client.exec({
    query: `
      CREATE TABLE ${tableName}
      (id UInt32, flag String)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  })

  console.info(`Created table ${tableName}`)

  console.log()
  console.log(
    `Batch size: ${BATCH_SIZE}, iterations count: ${ITERATIONS}, ` +
      `logging memory usage every ${LOG_INTERVAL} iterations`
  )

  console.log()
  console.log('Initial memory usage:')
  const initialMemoryUsage = getMemoryUsageInMegabytes()
  logMemoryUsage(initialMemoryUsage)
  let prevMemoryUsage = initialMemoryUsage

  for (let i = 1; i <= ITERATIONS; i++) {
    const stream = makeRowsStream()
    await client.insert({
      table: tableName,
      values: stream,
      format: 'TabSeparated',
    })
    if (i % LOG_INTERVAL === 0) {
      const currentMemoryUsage = getMemoryUsageInMegabytes()
      logMemoryUsageOnIteration({
        iteration: i,
        prevMemoryUsage,
        currentMemoryUsage,
      })
      prevMemoryUsage = currentMemoryUsage
    }
  }

  logFinalMemoryUsage(initialMemoryUsage)
  process.exit(0)
}

function makeRowsStream() {
  let i = 0
  async function* gen() {
    while (true) {
      if (i >= BATCH_SIZE) {
        return
      }
      yield `${randomInt(1, 1000)}\t${randomInt(1, 1000)}\n`
      i++
    }
  }
  return Stream.Readable.from(gen(), { objectMode: false })
}

attachExceptionHandlers()
const ITERATIONS = +(process.env['ITERATIONS'] || 10000)
const BATCH_SIZE = +(process.env['BATCH_SIZE'] || 10000)
const LOG_INTERVAL = +(process.env['LOG_INTERVAL'] || 1000)

void program()
