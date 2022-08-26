import Stream from 'stream'
import { createClient } from '../../src'
import { v4 as uuid_v4 } from 'uuid'
import { randomInt } from 'crypto'
import { memoryUsage } from 'process'

const program = async () => {
  const client = createClient({})
  const tableName = `memory_leak_test_${uuid_v4().replace(/-/g, '')}`

  await client.command({
    query: `
      CREATE TABLE ${tableName} 
      (id UInt32, guid UUID) 
      ENGINE MergeTree() 
      ORDER BY (id)
    `,
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  })

  console.info(`Created table ${tableName}`)

  console.log()
  console.log('Initial memory usage:')
  const initialMemoryUsage = getMemoryUsageInMegabytes()
  let prevMemoryUsage = initialMemoryUsage

  for (let i = 0; i < 10000; i++) {
    const stream = makeRowsStream()
    await client.insert({
      table: tableName,
      values: stream,
      format: 'TabSeparated',
    })
    if (i % 100 === 0) {
      console.log()
      console.log(
        '============================================================='
      )
      console.log(`${i} iteration`)
      console.log(
        '============================================================='
      )
      console.log('Current memory usage:')
      const currentMemoryUsage = getMemoryUsageInMegabytes()
      logMemoryUsageDiff({
        prev: prevMemoryUsage,
        cur: currentMemoryUsage,
      })
      prevMemoryUsage = currentMemoryUsage
    }
  }

  console.log()
  console.log('=============================================================')
  console.log('Final diff between start and end of the test')
  console.log('=============================================================')
  logMemoryUsageDiff({
    prev: initialMemoryUsage,
    cur: prevMemoryUsage,
  })
  process.exit(0)
}

function makeRowsStream() {
  let str = ''
  for (let i = 0; i < 10000; i++) {
    str += `${randomInt(1, 1000)}\t${uuid_v4()}\n`
  }
  return Stream.Readable.from(str, { objectMode: false })
}

process.on('uncaughtException', (err) => logAndQuit(err))
process.on('unhandledRejection', (err) => logAndQuit(err))

function logAndQuit(err: unknown) {
  console.error(err)
  process.exit(1)
}

interface MemoryUsage {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
}

function getMemoryUsageInMegabytes(): MemoryUsage {
  const mu = memoryUsage()
  console.log('-------------------------------------------------------------')
  for (const key in mu) {
    const k = key as keyof MemoryUsage
    mu[k] = mu[k] / (1024 * 1024) // Bytes -> Megabytes
    console.log(`${k}: ${mu[k].toFixed(2)} megabytes`)
  }
  console.log('-------------------------------------------------------------')
  return mu
}

function logMemoryUsageDiff({
  prev,
  cur,
}: {
  prev: MemoryUsage
  cur: MemoryUsage
}) {
  console.log('Total diff:')
  for (const key in prev) {
    const k = key as keyof MemoryUsage
    const diff = cur[k] - prev[k]
    console.log(
      `${k}: ${diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)} megabytes`
    )
  }
}

void program()
