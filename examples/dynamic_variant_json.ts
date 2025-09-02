import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

void (async () => {
  const tableName = `chjs_dynamic_variant_json`
  const client = createClient({
    // Since 25.3, all these types are no longer experimental and are enabled by default
    // However, if you are using an older version of ClickHouse, you might need these settings
    // to be able to create tables with such columns.
    clickhouse_settings: {
      // Variant was introduced in ClickHouse 24.1
      // https://clickhouse.com/docs/sql-reference/data-types/variant
      allow_experimental_variant_type: 1,
      // Dynamic was introduced in ClickHouse 24.5
      // https://clickhouse.com/docs/sql-reference/data-types/dynamic
      allow_experimental_dynamic_type: 1,
      // (New) JSON was introduced in ClickHouse 24.8
      // https://clickhouse.com/docs/sql-reference/data-types/newjson
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
      // A number will default to Int64; it could be also represented as a string in JSON* family formats
      // using `output_format_json_quote_64bit_integers` setting (default is 0 since CH 25.8).
      // See https://clickhouse.com/docs/en/operations/settings/formats#output_format_json_quote_64bit_integers
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
