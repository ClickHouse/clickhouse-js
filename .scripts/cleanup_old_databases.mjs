// ClickHouse does not have a dynamic DROP DATABASE command, so we need to query
// for the database names first and then drop them one by one.
// ClickHouse server also does not like dropping too many databases at once,
// so we will drop them sequentially to avoid overwhelming the server.

/**
 * Integrations tests take around 1 minute to run,
 * so we set TTL to 60 minutes by default to give some buffer.
 */
const TTL_MINUTES = process.env.TTL_MINUTES || 60
const PREFIX = process.env.PREFIX || 'clickhousejs_'
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
console.log(`🔍 Searching for databases matching "${PREFIX}%"...\n`)

// Query for databases
const query = `SELECT name FROM system.databases WHERE name LIKE '${PREFIX}%' FORMAT JSON`

const result = await executeQuery(query)
const { data } = await result.json()
if (data.length === 0) {
  console.log(`✅ No databases found matching "${PREFIX}%"`)
  process.exit(0)
}

console.log(`Found ${data.length} database(s):`)
data.forEach((row) => console.log(`  - ${row.name}`))
console.log()

// Shuffle the list to avoid dropping the same databases first every time
// and also allow for more efficient parallel dropping in case there
// are many databases to clean up.
data.sort(() => Math.random() - 0.5)

// Drop each database
let droppedCount = 0
for (const { name } of data) {
  try {
    const timestamp = new Date(Number(name.split('__').pop()))
    if (Date.now() - timestamp.getTime() < TTL_MINUTES * 60 * 1000) {
      console.log(
        `⏳ Skipping ${name} (created at ${timestamp.toISOString()}) - TTL not expired`,
      )
      continue
    }
    await executeQuery(`DROP DATABASE IF EXISTS ${name}`)
    console.log(`✅ Successfully dropped: ${name}`)
    droppedCount++
  } catch (error) {
    console.error(`❌ Failed to drop ${name}: ${error.message}`)
  }
}

console.log(`\n🎉 Cleanup completed! Dropped ${droppedCount} database(s).`)
