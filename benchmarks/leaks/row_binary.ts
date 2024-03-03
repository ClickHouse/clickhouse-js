import { createClient } from '@clickhouse/client'
import { RowBinaryResultSet } from '@clickhouse/client/result_set'

void (async () => {
  const client = createClient({
    url: 'http://localhost:8123',
  })
  async function streamRowBinary() {
    const start = +new Date()
    const rs = await client.query({
      query: `SELECT * FROM random ORDER BY id ASC LIMIT 10000`,
      format: 'RowBinary',
    })
    const values = await (rs as RowBinaryResultSet).get()
    // console.log(values)
    // console.log(
    //   `RowBinary elapsed: ${+new Date() - start} ms, length: ${values.length}`
    // )
    return values.length
  }

  for (let i = 0; i < 1000; i++) {
    await streamRowBinary()
  }

  process.exit(0)
})()
