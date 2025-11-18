import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

/**
 * Similar to `examples/insert_js_dates.ts` but testing custom JSON handling
 *
 * JSON.stringify does not handle BigInt data types by default, so we'll provide
 * a custom serializer before passing it to the JSON.stringify function.
 *
 * This example also shows how you can serialize Date objects in a custom way.
 */
void (async () => {
  const valueSerializer = (value: unknown): unknown => {
    if (value instanceof Date) {
      // if you would have put this in the `replacer` parameter of JSON.stringify, (e.x: JSON.stringify(obj, replacerFn))
      // it would have been an ISO string, but since we are serializing before `stringify`ing,
      // it will convert it before the `.toJSON()` method has been called
      return value.getTime()
    }

    if (typeof value === 'bigint') {
      return value.toString()
    }

    if (Array.isArray(value)) {
      return value.map(valueSerializer)
    }

    return value
  }

  const tableName = 'inserts_custom_json_handling'
  const client = createClient({
    json: {
      parse: JSON.parse,
      stringify: (obj: unknown) => JSON.stringify(valueSerializer(obj)),
    },
  })
  await client.command({
    query: `DROP TABLE IF EXISTS ${tableName}`,
  })
  await client.command({
    query: `
      CREATE TABLE ${tableName}
      (id UInt64, dt DateTime64(3, 'UTC'))
      ENGINE MergeTree()
      ORDER BY (id)
    `,
  })
  await client.insert({
    table: tableName,
    values: [
      {
        id: BigInt(250000000000000200),
        dt: new Date(),
      },
    ],
    format: 'JSONEachRow',
  })
  const rows = await client.query({
    query: `SELECT * FROM ${tableName}`,
    format: 'JSONEachRow',
  })
  console.info(await rows.json())
  await client.close()
})()
