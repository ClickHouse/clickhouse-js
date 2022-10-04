import type { Row } from '../src'
import { createClient } from '../src'

/**
 * Can be used for consuming large datasets for reducing memory overhead,
 * or if your response exceeds built in Node.js limitations,
 * such as 512Mb for strings.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/length#description
 * for more information.
 *
 * As `for await const` has quite significant overhead (up to 2 times worse)
 * vs old school `on(data)` approach, this example covers `on(data)` usage
 */
void (async () => {
  const client = createClient()
  const rows = await client.query({
    query: 'SELECT number FROM system.numbers_mt LIMIT 5',
    format: 'CSV',
  })
  const stream = rows.stream()
  stream.on('data', (rows) => {
    rows.forEach((row: Row) => {
      console.log(row.text)
    })
  })
  await new Promise((resolve) => {
    stream.on('end', () => {
      console.log('Completed!')
      resolve(0)
    })
  })
  await client.close()
  process.exit(0)
})()
