#!/usr/bin/env -S npx tsx

import { createClient } from '@clickhouse/client'

void (async () => {
  const client = createClient({
    compression: {
      response: true,
      request: true,
    },
  })

  try {
    const resultSet = await client.query({
      query: 'SELECT number FROM system.numbers LIMIT 10',
      format: 'JSONEachRow',
    })

    console.log('Query result with compression (server may use gzip or zstd):')
    console.log(await resultSet.json())

    const largeData = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      data: 'x'.repeat(100),
    }))

    await client.insert({
      table: 'test_compression',
      values: largeData,
      format: 'JSONEachRow',
    })

    console.log('Successfully inserted data with gzip request compression')
  } catch (error) {
    console.error('Error:', error)
  } finally {
    await client.close()
  }
})()
