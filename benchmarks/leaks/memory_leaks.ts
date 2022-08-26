import Stream from 'stream'
import { createClient } from '../../src'
import { v4 as uuid_v4 } from 'uuid'
import { randomInt } from 'crypto'
import {
  attachExceptionHandlers,
  getMemoryUsageInMegabytes,
  logMemoryUsageDiff,
} from './shared'

const program = async () => {
  attachExceptionHandlers()
  const client = createClient({})
  const tableName = `memory_leak_test_${uuid_v4().replace(/-/g, '')}`

  await client.command({
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
  console.log('Initial memory usage:')
  const initialMemoryUsage = getMemoryUsageInMegabytes()
  let prevMemoryUsage = initialMemoryUsage

  for (let i = 1; i <= 100000; i++) {
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
    // if (i % 1000 === 0) {
    //   console.log('Calling GC manually')
    //   global.gc()
    // }
  }

  console.log()
  console.log('=============================================================')
  console.log('Final diff between start and end of the test (before GC)')
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
    str += `${randomInt(1, 1000)}\t${randomInt(1, 1000)}\n`
  }
  return Stream.Readable.from(str, { objectMode: false })
}

void program()
