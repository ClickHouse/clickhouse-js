#!/usr/bin/env node

// ClickHouse does not have a dynamic DROP DATABASE command, so we need to query
// for the database names first and then drop them one by one.
// ClickHouse server also does not like dropping too many databases at once,
// so we will drop them sequentially to avoid overwhelming the server.

// Configuration
const CLICKHOUSE_CLOUD_HOST = process.env.CLICKHOUSE_CLOUD_HOST
const CLICKHOUSE_CLOUD_PASSWORD = process.env.CLICKHOUSE_CLOUD_PASSWORD

// Executes query using HTTP interface
async function executeQuery(query) {
  const r = await fetch(
    `https://${CLICKHOUSE_CLOUD_HOST}/?query=${encodeURIComponent(query)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`default:${CLICKHOUSE_CLOUD_PASSWORD}`).toString('base64')}`,
      },
    },
  )

  if (!r.ok) {
    try {
      const errorText = await r.text()
      throw new Error(
        `Query failed: ${r.status} ${r.statusText} - ${errorText}`,
      )
    } catch (e) {
      throw new Error(
        `Query failed: ${r.status} ${r.statusText} - Unable to read error details`,
      )
    }
  }

  return r
}

// Main script
console.log('🔍 Searching for databases matching "clickhousejs_%"...\n')

// Query for databases
const query =
  "SELECT name FROM system.databases WHERE name LIKE 'clickhousejs_%' FORMAT JSON"

const result = await executeQuery(query)
const { data } = await result.json()
if (data.length === 0) {
  console.log('✅ No databases found matching "clickhousejs_%"')
  process.exit(0)
}

console.log(`Found ${data.length} database(s):`)
data.forEach((row) => console.log(`  - ${row.name}`))
console.log()

// Drop each database
let droppedCount = 0
for (const { name } of data) {
  try {
    await executeQuery(`DROP DATABASE IF EXISTS ${name}`)
    console.log(`✅ Successfully dropped: ${name}`)
    droppedCount++
  } catch (error) {
    console.error(`❌ Failed to drop ${name}: ${error.message}`)
  }
}

console.log(`\n🎉 Cleanup completed! Dropped ${droppedCount} database(s).`)
