import { createClient } from '@clickhouse/client'
import type { Row } from '@clickhouse/client-common'
import * as Stream from 'node:stream'
import { EventEmitter } from 'node:events'

interface DataRow {
  id: number
  timestamp: Date
  message: string
  value: number
}

class BackpressureAwareDataProducer extends Stream.Readable {
  #dataSource: EventEmitter
  #streamPaused = false
  #pendingData: DataRow[] = []
  #isDestroyed = false
  #total = 0

  constructor(dataSource: EventEmitter, options?: Stream.ReadableOptions) {
    super({
      // Required for JSON* formats
      objectMode: true,
      // Limit buffering to prevent memory issues
      highWaterMark: 16,
      ...options,
    })

    this.#dataSource = dataSource
    this.#setupDataSourceListeners()
  }

  #setupDataSourceListeners() {
    this.#dataSource.on('data', this.#handleIncomingData.bind(this))
    this.#dataSource.on('end', this.#handleDataSourceEnd.bind(this))
    this.#dataSource.on('error', this.#handleDataSourceError.bind(this))
  }

  #handleIncomingData(data: DataRow) {
    if (this.#isDestroyed) {
      return
    }

    if (this.#streamPaused) {
      this.#pendingData.push(data)
      return
    }

    // Try to push the data immediately
    if (!this.#pushData(data)) {
      // If push returns false, we're experiencing backpressure
      // Pause the data source and buffer subsequent data
      this.#streamPaused = true
    }
  }

  #pushData(data: DataRow): boolean {
    if (this.#isDestroyed) {
      return false
    }

    // Convert data to JSON object for ClickHouse
    const jsonData = {
      id: data.id,
      timestamp: data.timestamp.toISOString(),
      message: data.message,
      value: data.value,
    }

    const pushed = this.push(jsonData)
    if (pushed) {
      this.#total++
      if (this.#total % 1000 === 0) {
        console.log(`Produced ${this.#total} rows`)
      }
    }
    return pushed
  }

  #handleDataSourceEnd() {
    console.log(`Data source ended. Total produced: ${this.#total} rows`)
    this.push(null)
  }

  #handleDataSourceError(error: Error) {
    console.error('Data source error:', error)
    this.destroy(error)
  }

  // Called when the stream is ready to accept more data (backpressure resolved)
  _read() {
    if (this.#streamPaused && this.#pendingData.length > 0) {
      // Process buffered data when backpressure is resolved
      this.#streamPaused = false

      // Push all pending data, but stop if we hit backpressure again
      while (this.#pendingData.length > 0 && !this.#streamPaused) {
        const data = this.#pendingData.shift()
        if (!data || !this.#pushData(data)) {
          this.#streamPaused = true
          break
        }
      }
    }
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.#isDestroyed = true
    this.#dataSource.removeAllListeners('data')
    this.#dataSource.removeAllListeners('end')
    this.#dataSource.removeAllListeners('error')
    callback(error)
  }

  get total(): number {
    return this.#total
  }
}

// Simulated data source that generates data at varying rates
class SimulatedDataSource extends EventEmitter {
  #intervalHandle: NodeJS.Timeout | null = null
  #isRunning = false
  #total = 0
  #burstMode = false

  start() {
    if (this.#isRunning) return

    this.#isRunning = true
    this.#scheduleNextBatch()

    // Randomly switch between normal and burst modes
    setInterval(() => {
      this.#burstMode = !this.#burstMode
      console.log(`Switched to ${this.#burstMode ? 'burst' : 'normal'} mode`)
    }, 10000)
  }

  #scheduleNextBatch() {
    if (!this.#isRunning) return

    // Variable delay to simulate real-world conditions
    const delay = this.#burstMode ? 10 : Math.random() * 100 + 50
    const batchSize = this.#burstMode
      ? Math.floor(Math.random() * 100) + 50
      : Math.floor(Math.random() * 10) + 1

    this.#intervalHandle = setTimeout(() => {
      this.#generateBatch(batchSize)
      this.#scheduleNextBatch()
    }, delay)
  }

  #generateBatch(size: number) {
    for (let i = 0; i < size; i++) {
      const id = this.#total++
      const data: DataRow = {
        id,
        timestamp: new Date(),
        message: `Message ${id} - ${Math.random().toString(36).substring(7)}`,
        value: Math.random() * 1000,
      }

      this.emit('data', data)
    }
  }

  stop() {
    this.#isRunning = false
    if (this.#intervalHandle) {
      clearTimeout(this.#intervalHandle)
      this.#intervalHandle = null
    }
    this.emit('end')
  }

  get total(): number {
    return this.#total
  }
}

void (async () => {
  const tableName = 'streaming_backpressure_demo'
  const client = createClient({
    // Configure client for high-throughput scenarios
    max_open_connections: 5,
    compression: {
      request: true,
      response: true,
    },
  })

  console.log('Setting up table...')

  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })

  await client.command({
    query: `
      CREATE OR REPLACE ${tableName}
      (
        id UInt64,
        timestamp DateTime,
        message String,
        value Float64
      )
      ENGINE = MergeTree()
      ORDER BY (id, timestamp)
    `,
  })

  // Create data source and producer
  const dataSource = new SimulatedDataSource()
  const dataProducer = new BackpressureAwareDataProducer(dataSource)

  // Start generating data
  console.log('Starting data generation...')
  dataSource.start()

  // Handle graceful shutdown
  const cleanup = async () => {
    console.log('\nShutting down gracefully...')
    dataSource.stop()

    // Wait a bit for any remaining data to be processed
    await new Promise((resolve) => setTimeout(resolve, 1000))

    console.log(`Final stats:`)
    console.log(`- Generated: ${dataSource.total} rows`)
    console.log(`- Produced: ${dataProducer.total} rows`)

    await client.close()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  try {
    console.log('Starting streaming insert...')
    const startTime = Date.now()

    await client.insert({
      table: tableName,
      values: dataProducer,
      format: 'JSONEachRow',
      clickhouse_settings: {
        // Optimize for streaming inserts
        async_insert: 1,
        wait_for_async_insert: 1,
        async_insert_max_data_size: '10485760', // 10MB
        async_insert_busy_timeout_ms: 1000,
      },
    })

    const duration = Date.now() - startTime

    console.log(`\nInsert completed in ${duration}ms`)
    console.log(`Inserted ${dataProducer.total} rows`)
    console.log('\nVerifying inserted data...')

    const result = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(timestamp) as min_timestamp,
          max(timestamp) as max_timestamp,
          avg(value) as avg_value
        FROM ${tableName}
      `,
      format: 'JSONEachRow',
    })

    const stats = await result.json<{
      total_rows: string
      min_timestamp: string
      max_timestamp: string
      avg_value: string
    }>()

    console.log('Verification results:', stats[0])

    const sampleResult = await client.query({
      query: `SELECT * FROM ${tableName} ORDER BY id LIMIT 5`,
      format: 'JSONEachRow',
    })

    console.log('\nSample data:')
    for await (const rows of sampleResult.stream()) {
      rows.forEach((row: Row) => {
        console.log(row.json())
      })
    }
  } catch (error) {
    console.error('Insert failed:', error)
  } finally {
    await cleanup()
  }
})()
