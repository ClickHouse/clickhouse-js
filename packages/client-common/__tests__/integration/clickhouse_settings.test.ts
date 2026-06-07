import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type {
  ClickHouseClient,
  ClickHouseSettings,
  InsertParams,
} from '@clickhouse/client-common'
import { SettingsMap } from '@clickhouse/client-common'
import { createSimpleTable } from '../fixtures/simple_table'
import { createTestClient, guid } from '../utils'

const enumSettings = [
  ['date_time_input_format', 'best_effort'],
  ['date_time_output_format', 'iso'],
  ['default_table_engine', 'Memory'],
  ['default_temporary_table_engine', 'Memory'],
  ['dialect', 'clickhouse'],
  ['distinct_overflow_mode', 'break'],
  ['distributed_ddl_output_mode', 'none'],
  ['distributed_product_mode', 'global'],
  ['except_default_mode', 'ALL'],
  ['format_capn_proto_enum_comparising_mode', 'by_names'],
  ['format_custom_escaping_rule', 'Raw'],
  ['format_regexp_escaping_rule', 'Raw'],
  ['group_by_overflow_mode', 'any'],
  ['intersect_default_mode', 'DISTINCT'],
  ['interval_output_format', 'kusto'],
  ['join_algorithm', 'hash'],
  ['join_default_strictness', 'ANY'],
  ['join_overflow_mode', 'break'],
  ['load_balancing', 'round_robin'],
  ['log_queries_min_type', 'EXCEPTION_WHILE_PROCESSING'],
  ['mysql_datatypes_support_level', 'decimal'],
  ['output_format_arrow_compression_method', 'none'],
  ['output_format_msgpack_uuid_representation', 'str'],
  ['output_format_orc_compression_method', 'none'],
  ['output_format_parquet_compression_method', 'none'],
  ['output_format_parquet_version', '2.6'],
  ['parallel_replicas_custom_key_filter_type', 'default'],
  ['read_overflow_mode', 'break'],
  ['read_overflow_mode_leaf', 'break'],
  ['result_overflow_mode', 'break'],
  ['send_logs_level', 'fatal'],
  ['set_overflow_mode', 'break'],
  ['short_circuit_function_evaluation', 'enable'],
  ['sort_overflow_mode', 'break'],
  ['storage_file_read_method', 'read'],
  ['timeout_overflow_mode', 'break'],
  ['totals_mode', 'after_having_inclusive'],
  ['transfer_overflow_mode', 'break'],
  ['union_default_mode', 'ALL'],
  ['wait_changes_become_visible_after_commit_mode', 'async'],
] satisfies Array<[keyof ClickHouseSettings, string]>

describe('ClickHouse settings', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('should work with additional_table_filters map', async () => {
    const result = await client
      .query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
        format: 'CSV',
        clickhouse_settings: {
          additional_table_filters: SettingsMap.from({
            'system.numbers': 'number != 3',
          }),
        },
      })
      .then((r) => r.text())
    expect(result).toEqual('0\n1\n2\n4\n5\n')
  })

  it.each(enumSettings)(
    'should work with enum setting %s',
    async (name, value) => {
      const clickhouse_settings: ClickHouseSettings = {
        [name]: value,
      }
      const result = await client
        .query({
          query: `SELECT toString(getSetting('${name}')) AS value`,
          format: 'JSONEachRow',
          clickhouse_settings,
        })
        .then((r) => r.json<{ value: string }>())

      expect(result).toEqual([{ value }])
    },
  )

  // covers both command and insert settings behavior
  // `insert_deduplication_token` will not work without
  // `non_replicated_deduplication_window` merge tree table setting
  // on a single node ClickHouse (but will work on cluster)
  it('should work with insert_deduplication_token', async () => {
    const tableName = `clickhouse_settings_insert__${guid()}`
    await createSimpleTable(client, tableName, {
      non_replicated_deduplication_window: '5',
    })
    const params: InsertParams = {
      table: tableName,
      values: [{ id: '1', name: 'foobar', sku: [1, 2] }],
      format: 'JSONEachRow',
    }
    // See https://clickhouse.com/docs/en/operations/settings/settings/#insert_deduplication_token
    await client.insert({
      // #1
      ...params,
      clickhouse_settings: {
        insert_deduplication_token: 'foo',
      },
    })
    await client.insert({
      // #2
      ...params,
      clickhouse_settings: {
        insert_deduplication_token: 'foo',
      },
    })
    await client.insert({
      // #3
      ...params,
      clickhouse_settings: {
        insert_deduplication_token: 'bar',
      },
    })
    // we will end up with two records since #2
    // is deduplicated due to the same token
    expect(
      await client
        .query({
          query: `SELECT * FROM ${tableName}`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json()),
    ).toEqual([
      { id: '1', name: 'foobar', sku: [1, 2] },
      { id: '1', name: 'foobar', sku: [1, 2] },
    ])
  })
})
