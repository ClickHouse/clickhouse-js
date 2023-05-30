import Stream from 'stream'
import { createClient } from '@clickhouse/client'
import { randomInt } from 'crypto'

// Open a single connection for streaming data insertion
// Periodically push the data into the stream
// Close the connection only when the application shuts down
// Might be useful for event listeners or some other similar use cases
//
// NB: results will not appear in ClickHouse immediately as it is buffered internally,
// and by default flushing happens very infrequently for smaller datasets,
// as ClickHouse awaits for the input stream to be terminated.
//
// For larger datasets, the data will be flushed more often,
// as it will exceed the buffer size quicker.
//
// To observe the results in ClickHouse, run this program for some time,
// and then terminate it with Ctrl+C.
// The data should appear in the table (almost) immediately
// after the stream is closed
void (async () => {
  const client = createClient()
  const tableName = 'endless_flowing_stream_raw'
  await client.exec({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.exec({
    query: `
      CREATE TABLE ${tableName}
      (id UInt32, name String)
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
    .then(() => console.info('\nData ingestion is finished'))

  console.info('Starting data ingestion, press Ctrl+C to stop')
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
    console.info('Pushing several records into the stream...')
    ;[...Array(3)].forEach(() => {
      const id = randomInt(1, 100_000_000)
      const name = Math.random().toString(36).slice(2)
      stream.push(`${id},"${name}"\n`)
    })
  }
}
