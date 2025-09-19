import { createClient } from '@clickhouse/client'
import * as Stream from 'node:stream'

interface DataRow {
  id: number
  name: string
  value: number
}

class SimpleBackpressureStream extends Stream.Readable {
  #currentId = 1
  #maxRecords = 0
  #intervalId: NodeJS.Timeout | null = null
  #isPaused = false

  constructor(maxRecords: number) {
    super({ objectMode: true, highWaterMark: 5 })
    this.#maxRecords = maxRecords
  }

  _read() {
    if (this.#isPaused) {
      console.log('Backpressure relieved - resuming data production')
      this.#isPaused = false
      this.#startProducing()
    }
  }

  #startProducing() {
    if (this.#intervalId || this.#currentId > this.#maxRecords) {
      return
    }

    this.#intervalId = setInterval(() => {
      if (this.#currentId > this.#maxRecords) {
        console.log('All data produced, ending stream')
        this.push(null) // End the stream
        this.#stopProducing()
        return
      }

      const data: DataRow = {
        id: this.#currentId++,
        name: `Name_${this.#currentId - 1}`,
        value: Math.random() * 1000,
      }
      const canContinue = this.push(data)

      if (!canContinue) {
        // console.log('Backpressure detected - pausing data production')
        this.#isPaused = true
        this.#stopProducing()
      } else if (this.#currentId % 500 === 0) {
        console.log(`Produced ${this.#currentId - 1} records`)
      }
    }, 1)
  }

  #stopProducing() {
    if (this.#intervalId) {
      clearInterval(this.#intervalId)
      this.#intervalId = null
    }
  }

  start() {
    this.#startProducing()
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.#stopProducing()
    callback(error)
  }
}

void (async () => {
  const tableName = 'simple_streaming_demo'
  const client = createClient()

  // Setup table
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })

  await client.command({
    query: `
      CREATE TABLE ${tableName}
      (
        id UInt32,
        name String,
        value Float64
      )
      ENGINE = MergeTree()
      ORDER BY id
    `,
  })

  const maxRecords = 10000
  console.log('Creating backpressure-aware data stream...')

  const dataStream = new SimpleBackpressureStream(maxRecords)

  try {
    console.log('Starting streaming insert with backpressure demonstration...')

    const insertPromise = client.insert({
      table: tableName,
      values: dataStream,
      format: 'JSONEachRow',
      clickhouse_settings: {
        // Use async inserts to handle streaming data more efficiently
        async_insert: 1,
        wait_for_async_insert: 1,
        async_insert_max_data_size: '10485760', // 10MB
        async_insert_busy_timeout_ms: 1000,
      },
    })

    setTimeout(() => dataStream.start(), 100)

    await insertPromise

    console.log('Insert completed successfully!')

    const result = await client.query({
      query: `SELECT count() as total FROM ${tableName}`,
      format: 'JSONEachRow',
    })

    const [{ total }] = await result.json<{ total: string }>()
    console.log(`Total records inserted: ${total}`)
  } catch (error) {
    console.error('Insert failed:', error)
  } finally {
    await client.close()
  }
})()
