/**
 * Test suite for minimal fetch client
 *
 * This file tests the minimal fetch client implementation to ensure it works correctly.
 * Run this after starting a local ClickHouse instance.
 */

import { createClient } from './minimal_fetch_client'

async function runTests() {
  console.log('Starting minimal fetch client tests...\n')

  let passedTests = 0
  let failedTests = 0

  // Test 1: Basic connection and ping
  try {
    console.log('Test 1: Ping')
    const client = createClient()
    const result = await client.ping()
    if (result.success) {
      console.log('✅ Ping successful')
      passedTests++
    } else {
      console.error('❌ Ping failed:', result.error)
      failedTests++
    }
    await client.close()
  } catch (error) {
    console.error('❌ Ping test error:', error)
    failedTests++
  }

  // Test 2: Simple query
  try {
    console.log('\nTest 2: Simple query')
    const client = createClient()
    const result = await client.query({
      query: 'SELECT number FROM system.numbers LIMIT 3',
      format: 'JSONEachRow',
    })
    if (Array.isArray(result) && result.length === 3) {
      console.log('✅ Simple query successful:', result)
      passedTests++
    } else {
      console.error('❌ Simple query failed: unexpected result', result)
      failedTests++
    }
    await client.close()
  } catch (error) {
    console.error('❌ Simple query error:', error)
    failedTests++
  }

  // Test 3: Create table, insert, and select
  try {
    console.log('\nTest 3: Create table, insert, and select')
    const client = createClient()
    const tableName = 'minimal_fetch_test_' + Date.now()

    // Drop if exists
    await client.command({
      query: `DROP TABLE IF EXISTS ${tableName}`,
    })

    // Create table
    await client.command({
      query: `
        CREATE TABLE ${tableName}
        (id UInt64, name String, created DateTime DEFAULT now())
        ENGINE MergeTree()
        ORDER BY (id)
      `,
    })

    // Insert data
    await client.insert({
      table: tableName,
      values: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ],
      format: 'JSONEachRow',
    })

    // Query data
    const rows = await client.query({
      query: `SELECT id, name FROM ${tableName} ORDER BY id`,
      format: 'JSONEachRow',
    })

    if (
      Array.isArray(rows) &&
      rows.length === 3 &&
      rows[0].id === 1 &&
      rows[0].name === 'Alice' &&
      rows[2].name === 'Charlie'
    ) {
      console.log('✅ Create, insert, select successful:', rows)
      passedTests++
    } else {
      console.error('❌ Create, insert, select failed: unexpected result', rows)
      failedTests++
    }

    // Cleanup
    await client.command({
      query: `DROP TABLE ${tableName}`,
    })

    await client.close()
  } catch (error) {
    console.error('❌ Create, insert, select error:', error)
    failedTests++
  }

  // Test 4: Query with parameters
  try {
    console.log('\nTest 4: Query with parameters')
    const client = createClient()
    const result = await client.query({
      query:
        'SELECT number FROM system.numbers WHERE number >= {min:UInt64} AND number < {max:UInt64}',
      format: 'JSONEachRow',
      query_params: {
        min: 5,
        max: 8,
      },
    })

    if (Array.isArray(result) && result.length === 3) {
      console.log('✅ Query with parameters successful:', result)
      passedTests++
    } else {
      console.error(
        '❌ Query with parameters failed: unexpected result',
        result,
      )
      failedTests++
    }
    await client.close()
  } catch (error) {
    console.error('❌ Query with parameters error:', error)
    failedTests++
  }

  // Test 5: Query with ClickHouse settings
  try {
    console.log('\nTest 5: Query with ClickHouse settings')
    const client = createClient()
    const result = await client.query({
      query: 'SELECT version() as version',
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 60,
      },
    })

    if (Array.isArray(result) && result.length > 0 && result[0].version) {
      console.log('✅ Query with settings successful:', result[0].version)
      passedTests++
    } else {
      console.error('❌ Query with settings failed: unexpected result', result)
      failedTests++
    }
    await client.close()
  } catch (error) {
    console.error('❌ Query with settings error:', error)
    failedTests++
  }

  // Test 6: JSON format (not JSONEachRow)
  try {
    console.log('\nTest 6: JSON format')
    const client = createClient()
    const result = await client.query({
      query: 'SELECT number FROM system.numbers LIMIT 2',
      format: 'JSON',
    })

    if (Array.isArray(result) && result.length === 2) {
      console.log('✅ JSON format successful:', result)
      passedTests++
    } else {
      console.error('❌ JSON format failed: unexpected result', result)
      failedTests++
    }
    await client.close()
  } catch (error) {
    console.error('❌ JSON format error:', error)
    failedTests++
  }

  // Test 7: Ping to non-existing host (should fail gracefully)
  try {
    console.log('\nTest 7: Ping to non-existing host')
    const client = createClient({
      url: 'http://localhost:9999',
      request_timeout: 100,
    })
    const result = await client.ping()
    if (!result.success && result.error) {
      console.log('✅ Failed ping handled correctly:', result.error.message)
      passedTests++
    } else {
      console.error('❌ Failed ping test: expected failure but got success')
      failedTests++
    }
    await client.close()
  } catch (error) {
    console.error('❌ Failed ping test error:', error)
    failedTests++
  }

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('Test Results:')
  console.log(`Passed: ${passedTests}`)
  console.log(`Failed: ${failedTests}`)
  console.log(`Total: ${passedTests + failedTests}`)
  console.log('='.repeat(50))

  if (failedTests === 0) {
    console.log('\n🎉 All tests passed!')
  } else {
    console.log('\n⚠️  Some tests failed. Please check the output above.')
    process.exit(1)
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
