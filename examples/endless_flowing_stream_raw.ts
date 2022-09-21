import Stream from 'stream'
import { createClient } from '@clickhouse/client'
import { randomInt } from 'crypto'

// Open a single connection for streaming data insertion
// Periodically push the data into the stream
// Close the connection only when the application shuts down
// Might be useful for event listeners or some other similar use cases
void (async () => {
  const client = createClient()
  const tableName = 'insert_flowing_stream_raw'
  await client.exec({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.exec({
    query: `
      CREATE TABLE ${tableName}
      (id UInt64, name String)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
  const stream = new Stream.Readable({
    objectMode: false, // required for "raw" family formats
    read() {
      //
    },
  })
  // note that we do not await the promise yet
  const insertPromise = client
    .insert({
      table: tableName,
      values: stream,
      format: 'CSV',
    })
    .then(() => console.info('Data ingestion is finished'))

  // Periodically generate some random data and push it into the stream...
  const timer = setInterval(pushData(stream), 1000)

  // When Ctrl+C is pressed...
  async function cleanup() {
    clearInterval(timer)
    // finally, close the stream
    stream.push(null)
    // when the stream is closed, the insert stream can be awaited
    await insertPromise
    await client.close()
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
})()

function pushData(stream: Stream.Readable) {
  return async () => {
    const csv = [...Array(3)]
      .map(() => {
        const id = randomInt(1, 100_000_000)
        const name = Math.random().toString(36).slice(2)
        return `${id},${name}`
      })
      .join('\n')
    stream.push(csv)
  }
}
