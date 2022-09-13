import { createClient } from '../../src'
import { v4 as uuid_v4 } from 'uuid'
import { randomInt } from 'crypto'
import {
  attachExceptionHandlers,
  getMemoryUsageInMegabytes,
  logFinalMemoryUsage,
  logMemoryUsage,
  logMemoryUsageOnIteration,
  randomArray,
  randomStr,
} from './shared'

const program = async () => {
  const client = createClient({})
  const tableName = `memory_leak_arrays_${uuid_v4().replace(/-/g, '')}`

  await client.exec({
    query: `
      CREATE TABLE ${tableName}
      (
          id UInt32,
          data Array(String),
          data2 Map(String, Array(String))
      )
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
    const values = makeRows()
    await client.insert({
      table: tableName,
      format: 'JSONEachRow',
      values,
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

function makeRows(): Row[] {
  const batch = new Array(BATCH_SIZE)
  for (let i = 0; i < BATCH_SIZE; i++) {
    const data: Row['data'] = randomArray(randomInt(5, 10), randomStr)
    const data2: Row['data2'] = {}
    for (let i = 0; i < randomInt(5, 10); i++) {
      data2[randomStr()] = randomArray(randomInt(5, 10), randomStr)
    }
    const row: Row = {
      id: randomInt(1, 1000),
      data,
      data2,
    }
    batch.push(row)
  }
  return batch
}

interface Row {
  id: number
  data: string[]
  data2: Record<string, string[]>
}

attachExceptionHandlers()
const ITERATIONS = +(process.env['ITERATIONS'] || 1000)
const BATCH_SIZE = +(process.env['BATCH_SIZE'] || 1000)
const LOG_INTERVAL = +(process.env['LOG_INTERVAL'] || 100)

void program()
