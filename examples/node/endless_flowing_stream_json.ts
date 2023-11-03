import { createClient } from '@clickhouse/client'
import type { InsertResult } from '@clickhouse/client-common'
import { randomInt } from 'crypto'
import process from 'node:process'
import Stream from 'stream'

// - Open a single connection at a time for streaming data insertion
// - Periodically push the data into the stream
// - Periodically flush the insert stream and recreate it
//
// Might be useful for event listeners or some other similar use cases
//
// NB: results will not appear in ClickHouse immediately as it is buffered internally,
// and by default flushing happens very infrequently for smaller datasets,
// as ClickHouse awaits for the input stream to be terminated.
// In this scenario, it will happen every 25 seconds.
//
// For larger datasets, the data will be flushed on the server side more often,
// as it will exceed the buffer size quicker.

void (async () => {
  const client = createClient({
    // should be in sync with http_receive_timeout profile setting
    request_timeout: 30_000,
  })
  const tableName = 'endless_flowing_stream_json'
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName}
      (id UInt64, name String)
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })

  // Note: we do not send the insert request right away.
  // It will be created only when there is some data to send for the first time.
  // Otherwise, if the request will have no initial data for `keep_alive_timeout` seconds (ClickHouse server setting),
  // it will be closed by the server no matter what.
  let insertFlow:
    | {
        stream: Stream.Readable
        promise: Promise<InsertResult>
      }
    | undefined

  function pushData() {
    if (insertFlow === undefined) {
      const stream = new Stream.Readable({
        objectMode: true, // required for JSON* family formats
        read() {
          //
        },
      })
      // Note that this request promise is not awaited
      const promise = client.insert({
        table: tableName,
        values: stream,
        format: 'JSONEachRow',
      })
      insertFlow = {
        stream,
        promise,
      }
      console.info('Insert stream was (re)created')
    }
    console.info('Pushing several records into the stream...')
    return [...Array(3)].forEach(() => {
      insertFlow!.stream.push({
        id: randomInt(1, 100_000_000),
        name: Math.random().toString(36).slice(2),
      })
    })
  }

  async function flushInsertStream() {
    console.info('Flushing the insert stream...')
    if (insertFlow !== undefined) {
      // swap the values here to avoid a potential switch to `pushData`
      // due to awaiting the insert promise when the previous stream was already closed
      const prevFlow = insertFlow
      insertFlow = undefined
      prevFlow.stream.push(null)
      await prevFlow.promise
      // insertFlow (stream + insert request) will be recreated on the next `pushData` call
    }
  }

  console.info('Starting data ingestion, press Ctrl+C to stop')
  // Periodically generate some random data and push it into the stream...
  const pushDataTimer = setInterval(pushData, 1000)
  // ClickHouse `http_receive_timeout` profile setting is 30s by default
  // Unfortunately, it cannot be overridden from the client side
  // So, we need some safe value to periodically flush the insert stream
  // which will be recreated the next time there is some data to push
  const flushTimer = setInterval(flushInsertStream, 25_000)

  // When Ctrl+C is pressed...
  async function cleanup() {
    clearInterval(pushDataTimer)
    clearInterval(flushTimer)
    await flushInsertStream()
    await client.close()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
})()
