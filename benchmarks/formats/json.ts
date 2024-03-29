import { createClient } from '@clickhouse/client'
import { attachExceptionHandlers } from '../common'

/*
Large strings table definition:

  CREATE TABLE large_strings
  (
      `id` UInt32,
      `s1` String,
      `s2` String,
      `s3` String
  )
  ENGINE = MergeTree
  ORDER BY id;

  INSERT INTO large_strings
  SELECT number + 1,
         randomPrintableASCII(randUniform(500, 2500)) AS s1,
         randomPrintableASCII(randUniform(500, 2500)) AS s2,
         randomPrintableASCII(randUniform(500, 2500)) AS s3
  FROM numbers(100000);
*/

const WarmupIterations = 3
const BenchmarkIterations = 10

const largeStringsQuery = `SELECT * FROM large_strings ORDER BY id ASC LIMIT 100000`
const cellTowersQuery = `SELECT * FROM cell_towers ORDER BY (radio, mcc, net, created) ASC LIMIT 500000`
const queries = [largeStringsQuery, cellTowersQuery]

const formats = ['JSON', 'JSONEachRow', 'JSONObjectEachRow'] as const

void (async () => {
  const client = createClient({
    url: 'http://localhost:8123',
    compression: {
      request: false,
      response: false,
    },
  })

  type TotalPerQuery = Record<string, number>
  const results: Record<(typeof formats)[number], TotalPerQuery> = {
    JSON: {},
    JSONEachRow: {},
    JSONObjectEachRow: {},
  }

  async function benchmarkJSON(
    format: (typeof formats)[number],
    query: string,
    keepResults: boolean,
  ) {
    const start = +new Date()
    const rs = await client.query({
      query,
      format,
    })
    await rs.json() // discard the result
    const elapsed = +new Date() - start
    if (keepResults) {
      const current = results[format][query] ?? 0
      results[format][query] = current + elapsed
    }
    logResult(format, query, elapsed)
  }

  attachExceptionHandlers()
  process.on('SIGINT', closeAndExit)
  process.on('SIGINT', closeAndExit)

  console.log('Warmup')
  for (let i = 0; i < WarmupIterations; i++) {
    await runQueries(false)
  }
  console.log('Benchmarking')
  for (let i = 0; i < BenchmarkIterations; i++) {
    await runQueries(true)
  }
  console.log('Results:', results)
  console.log('Average results:')
  for (const format of formats) {
    for (const query of queries) {
      const avg = Math.floor(results[format][query] / BenchmarkIterations)
      logResult(format, query, avg)
    }
  }
  await closeAndExit()

  function logResult(format: string, query: string, elapsed: number) {
    const elapsedStr = elapsed.toString(10) + ' ms'
    console.log(
      `[${elapsedStr.padEnd(10)}][${format.padEnd(18)}][${query.padEnd(80)}]`,
    )
  }

  async function runQueries(keepResults: boolean) {
    for (const query of queries) {
      for (const format of formats) {
        await benchmarkJSON(format, query, keepResults)
      }
    }
  }

  async function closeAndExit() {
    await client.close()
    process.exit(0)
  }
})()
