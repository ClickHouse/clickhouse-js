import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

/**
 * A simple example that demonstrates counting to 5 using ClickHouse.
 * This example creates a table, inserts numbers 1 through 5,
 * and then queries them back in order.
 */

const client = createClient()

// Create a table to store our numbers
await client.command({
  query: `
    CREATE TABLE IF NOT EXISTS count_to_five_example
    (number UInt8)
    ENGINE MergeTree()
    ORDER BY (number)
  `,
})

console.log('Table created successfully')

// Insert numbers 1 through 5
await client.insert({
  table: 'count_to_five_example',
  values: [
    { number: 1 },
    { number: 2 },
    { number: 3 },
    { number: 4 },
    { number: 5 },
  ],
  format: 'JSONEachRow',
})

console.log('Inserted numbers 1 through 5')

// Query the numbers back
const resultSet = await client.query({
  query: 'SELECT number FROM count_to_five_example ORDER BY number',
  format: 'JSONEachRow',
})

const data = await resultSet.json<{ number: number }>()

console.log('Counting to 5:')
data.forEach((row) => {
  console.log(row.number)
})

// Clean up: drop the table
await client.command({
  query: 'DROP TABLE IF EXISTS count_to_five_example',
})

console.log('Table dropped successfully')

await client.close()
