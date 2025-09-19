import { createClient } from '@clickhouse/client'
import * as Stream from 'stream'

interface DataRow {
  id: number
  name: string
  value: number
}

class DataStreamWithBackpressure extends Stream.Readable {
  #dataQueue: DataRow[] = []
  #isReading = false
  #hasEnded = false

  constructor() {
    super({ objectMode: true, highWaterMark: 10 })
  }

  addData(data: DataRow): boolean {
    if (this.#hasEnded) {
      return false
    }

    // If we're currently reading, try to push immediately
    if (this.#isReading && this.#dataQueue.length === 0) {
      return this.#pushData(data)
    } else {
      // Otherwise, queue the data
      this.#dataQueue.push(data)
      return true
    }
  }

  endStream() {
    this.#hasEnded = true
    if (this.#dataQueue.length === 0) {
      super.push(null)
    }
  }

  _read() {
    this.#isReading = true

    while (this.#dataQueue.length > 0) {
      const data = this.#dataQueue.shift()

      if (!data || !this.#pushData(data)) {
        this.#isReading = false
        return
      }
    }

    // If all data is processed and stream should end
    if (this.#hasEnded && this.#dataQueue.length === 0) {
      super.push(null)
    }

    this.#isReading = false
  }

  #pushData(data: DataRow): boolean {
    // Convert to JSON format for ClickHouse
    const jsonLine = JSON.stringify(data)
    return super.push(jsonLine)
  }
}

void (async () => {
  const client = createClient()
  const tableName = 'simple_streaming_demo'

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

  const dataStream = new DataStreamWithBackpressure()
  const addDataToStream = () => {
    const maxRecords = 10000
    let id = 1
    let addedCount = 0

    const addBatch = () => {
      // Add a batch of records
      const batchSize = Math.min(100, maxRecords - addedCount)

      for (let i = 0; i < batchSize; i++) {
        const success = dataStream.addData({
          id: id++,
          name: `Name_${id}`,
          value: Math.random() * 1000,
        })

        if (!success) {
          console.log('Failed to add data - stream ended')
          return
        }
      }

      addedCount += batchSize
      console.log(`Added batch of ${batchSize} records (total: ${addedCount})`)

      if (addedCount < maxRecords) {
        // Continue adding data with a small delay
        setTimeout(addBatch, 10)
      } else {
        console.log('Finished adding data, ending stream')
        dataStream.endStream()
      }
    }

    addBatch()
  }

  try {
    console.log('Starting streaming insert...')

    // Start adding data in the background
    addDataToStream()

    // Perform the streaming insert
    await client.insert({
      table: tableName,
      values: dataStream,
      format: 'JSONEachRow',
    })

    console.log('Insert completed successfully!')

    // Verify the results
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
