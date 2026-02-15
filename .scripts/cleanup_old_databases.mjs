#!/usr/bin/env npx zx

// ClickHouse does not have a dynamic DROP DATABASE command, so we need to query
// for the database names first and then drop them one by one.
// ClickHouse server also does not like dropping too many databases at once,
// so we will drop them sequentially to avoid overwhelming the server.

// Configuration
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'localhost'
const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT || '8123'
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default'
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || ''

// Build CLI command arguments
function getCliArgs() {
  const args = ['--host', CLICKHOUSE_HOST, '--port', CLICKHOUSE_PORT]

  if (CLICKHOUSE_USER) {
    args.push('--user', CLICKHOUSE_USER)
  }

  if (CLICKHOUSE_PASSWORD) {
    args.push('--password', CLICKHOUSE_PASSWORD)
  }

  return args
}

// Execute query and return results
async function executeQuery(query) {
  const args = [...getCliArgs(), '--query', query]
  const result = await $`clickhouse-client ${args}`
  return result.stdout.trim()
}

// Main script
console.log('🔍 Searching for databases matching "clickhousejs_%"...\n')

// Query for databases
const query =
  "SELECT name FROM system.databases WHERE name LIKE 'clickhousejs_%'"

try {
  const result = await executeQuery(query)

  if (!result) {
    console.log('✅ No databases found matching "clickhousejs_%"')
    process.exit(0)
  }

  // Parse database names (one per line)
  const databases = result.split('\n').filter((db) => db.trim())

  console.log(`Found ${databases.length} database(s):`)
  databases.forEach((db) => console.log(`  - ${db}`))
  console.log()

  // Drop each database
  for (const dbName of databases) {
    try {
      console.log(`🗑️  Dropping database: ${dbName}`)
      await executeQuery(`DROP DATABASE IF EXISTS ${dbName}`)
      console.log(`✅ Successfully dropped: ${dbName}`)
    } catch (error) {
      console.error(`❌ Failed to drop ${dbName}: ${error.message}`)
    }
  }

  console.log(
    `\n🎉 Cleanup completed! Dropped ${databases.length} database(s).`,
  )
} catch (error) {
  console.error('❌ Failed to query databases:', error.message)
  process.exit(1)
}
