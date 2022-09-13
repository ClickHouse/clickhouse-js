import { createClient } from '../../src'
import { v4 as uuid_v4 } from 'uuid'
import Path from 'path'
import Fs from 'fs'
import {
  attachExceptionHandlers,
  getMemoryUsageInMegabytes,
  logFinalMemoryUsage,
  logMemoryUsage,
  logMemoryUsageDiff,
} from './shared'

const program = async () => {
  const client = createClient({})
  const tableName = `memory_leak_test_brown_${uuid_v4().replace(/-/g, '')}`

  await client.exec({
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
  logMemoryUsage(initialMemoryUsage)
  let prevMemoryUsage = initialMemoryUsage

  setInterval(() => {
    console.log()
    console.log('Current memory usage:')
    const currentMemoryUsage = getMemoryUsageInMegabytes()
    logMemoryUsage(currentMemoryUsage)
    console.log('Diff from previous measurement:')
    logMemoryUsageDiff({
      previous: prevMemoryUsage,
      current: currentMemoryUsage,
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

  logFinalMemoryUsage(initialMemoryUsage)
  process.exit(0)
}

attachExceptionHandlers()
void program()
