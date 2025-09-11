import type { ClickHouseClient } from '@clickhouse/client-common'
import { fakerRU } from '@faker-js/faker'
import { createTableWithFields } from '@test/fixtures/table_with_fields'

export async function genLargeStringsDataset<Stream = unknown>(
  client: ClickHouseClient<Stream>,
  {
    rows,
    words,
  }: {
    rows: number
    words: number
  },
): Promise<{
  table: string
  values: Array<{ id: number; sentence: string; timestamp: string }>
}> {
  const table = await createTableWithFields(
    client as ClickHouseClient,
    `sentence String, timestamp String`,
  )
  const values = [...new Array(rows)].map((_, id) => ({
    id,
    // it seems that it is easier to trigger an incorrect behavior with non-ASCII symbols
    sentence: fakerRU.lorem.sentence(words),
    timestamp: new Date().toISOString(),
  }))
  await client.insert({
    table,
    values,
    format: 'JSONEachRow',
  })
  return {
    table,
    values,
  }
}
