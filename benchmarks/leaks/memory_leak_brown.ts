import { createClient } from '../../src'
import { v4 as uuid_v4 } from 'uuid'
import Path from 'path'
import Fs from 'fs'
import {
  attachExceptionHandlers,
  getMemoryUsageInMegabytes,
  logMemoryUsageDiff,
} from './shared'

const program = async () => {
  attachExceptionHandlers()
  const client = createClient({})
  const tableName = `memory_leak_test_file_${uuid_v4().replace(/-/g, '')}`

  await client.command({
    query: `
      CREATE TABLE ${tableName} (
         log_time      DateTime,
         machine_name  LowCardinality(String),
         machine_group LowCardinality(String),
         cpu_idle      Nullable(Float32),
         cpu_nice      Nullable(Float32),
         cpu_system    Nullable(Float32),
         cpu_user      Nullable(Float32),
         cpu_wio       Nullable(Float32),
         disk_free     Nullable(Float32),
         disk_total    Nullable(Float32),
         part_max_used Nullable(Float32),
         load_fifteen  Nullable(Float32),
         load_five     Nullable(Float32),
         load_one      Nullable(Float32),
         mem_buffers   Nullable(Float32),
         mem_cached    Nullable(Float32),
         mem_free      Nullable(Float32),
         mem_shared    Nullable(Float32),
         swap_free     Nullable(Float32),
         bytes_in      Nullable(Float32),
         bytes_out     Nullable(Float32)
      )
      ENGINE = MergeTree()
      ORDER BY (machine_group, machine_name, log_time)
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

  setInterval(() => {
    console.log()
    console.log('Current memory usage:')
    const currentMemoryUsage = getMemoryUsageInMegabytes()
    console.log('Diff from previous measurement:')
    logMemoryUsageDiff({
      prev: prevMemoryUsage,
      cur: currentMemoryUsage,
    })
    prevMemoryUsage = currentMemoryUsage
  }, 1000)

  console.time('insert')
  const filename = Path.resolve(
    process.cwd(),
    'benchmarks/leaks/input/mgbench1.csv'
  )
  await client.insert({
    table: tableName,
    values: Fs.createReadStream(filename),
    format: 'CSVWithNames',
  })
  console.timeEnd('insert')

  console.log()
  console.log('=============================================================')
  console.log('Final diff between start and end of the test (before GC call)')
  console.log('=============================================================')
  logMemoryUsageDiff({
    prev: initialMemoryUsage,
    cur: getMemoryUsageInMegabytes(false),
  })

  if (global.gc) {
    global.gc()
    console.log()
    console.log('=============================================================')
    console.log('Final diff between start and end of the test  (after GC call)')
    console.log('=============================================================')
    logMemoryUsageDiff({
      prev: initialMemoryUsage,
      cur: getMemoryUsageInMegabytes(false),
    })
  } else {
    console.log('GC is not exposed. Re-run the test with --expose_gc node flag')
  }

  process.exit(0)
}

void program()
