import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

/**
 * Applying ClickHouse settings on the client or the operation level.
 * See also: {@link ClickHouseSettings} typings.
 */
void (async () => {
  const client = createClient({
    // Settings applied in the client settings will be added to every request.
    clickhouse_settings: {
      date_time_input_format: 'best_effort',
    },
  })
  const rows = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 2',
    format: 'JSONEachRow',
    /**
     * Apply these settings only for this query;
     * overrides the defaults set in the client instance settings.
     * Similarly, you can apply the settings for a particular
     * {@link ClickHouseClient.insert},
     * {@link ClickHouseClient.command},
     * or {@link ClickHouseClient.exec} operation.*/
    clickhouse_settings: {
      // default is 0 since 25.8
      output_format_json_quote_64bit_integers: 1,
    },
  })
  console.info(await rows.json())
  await client.close()
})()
