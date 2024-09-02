import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

void (async () => {
  const tableName = `chjs_dynamic_variant_json`
  const client = createClient({
    clickhouse_settings: {
      // Since ClickHouse 24.1
      allow_experimental_variant_type: 1,
      // Since ClickHouse 24.5
      allow_experimental_dynamic_type: 1,
      // Since ClickHouse 24.8
      allow_experimental_json_type: 1,
    },
  })
  await client.command({
    query: `
      CREATE OR REPLACE TABLE ${tableName}
      (
        id              UInt64,
        var             Variant(Int64, String),
        dynamic         Dynamic,
        json            JSON
      )
      ENGINE MergeTree
      ORDER BY id
    `,
  })
  // Sample representation in JSONEachRow format
  const values = [
    {
      id: 1,
      var: 42,
      dynamic: 'foo',
      json: {
        foo: 'x',
      },
    },
    {
      id: 2,
      var: 'str',
      // defaults to Int64; will be represented as a string in JSON* family formats
      // this behavior can be changed with `output_format_json_quote_64bit_integers` setting (default is 1).
      // see https://clickhouse.com/docs/en/operations/settings/formats#output_format_json_quote_64bit_integers
      dynamic: 144,
      json: {
        bar: 10,
      },
    },
  ]
  await client.insert({
    table: tableName,
    format: 'JSONEachRow',
    values,
  })
  const rs = await client.query({
    query: `
      SELECT *,
             variantType(var),
             dynamicType(dynamic),
             dynamicType(json.foo),
             dynamicType(json.bar)
      FROM ${tableName}
    `,
    format: 'JSONEachRow',
  })
  console.log(await rs.json())
  await client.close()
})()
