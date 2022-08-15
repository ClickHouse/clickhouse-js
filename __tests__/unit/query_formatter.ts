import * as ch from '../../src/schema';
import { QueryFormatter } from '../../src/schema/query_formatter';

describe('QueryFormatter', () => {
  it('should render a simple CREATE TABLE statement', async () => {
    const schema = new ch.Schema({
      foo: ch.String,
      bar: ch.UInt8,
    });
    const tableOptions = {
      name: 'my_table',
      schema,
    };
    expect(
      QueryFormatter.createTable(tableOptions, {
        engine: ch.MergeTree(),
        orderBy: ['foo'],
      })
    ).toEqual(
      'CREATE TABLE my_table (foo String, bar UInt8) ENGINE MergeTree() ORDER BY (foo)'
    );
  });

  it('should render a complex CREATE TABLE statement', async () => {
    const schema = new ch.Schema({
      foo: ch.String,
      bar: ch.UInt8,
    });
    const tableOptions = {
      name: 'my_table',
      schema,
    };
    expect(
      QueryFormatter.createTable(tableOptions, {
        engine: ch.MergeTree(),
        ifNotExist: true,
        onCluster: '{cluster}',
        orderBy: ['foo', 'bar'],
        partitionBy: ['foo'],
        primaryKey: ['bar'],
        settings: {
          merge_max_block_size: 16384,
          enable_mixed_granularity_parts: 1,
        },
      })
    ).toEqual(
      `CREATE TABLE IF NOT EXISTS my_table ON CLUSTER '{cluster}' ` +
        '(foo String, bar UInt8) ' +
        'ENGINE MergeTree() ' +
        'ORDER BY (foo, bar) ' +
        'PARTITION BY (foo) ' +
        'PRIMARY KEY (bar) ' +
        'SETTINGS merge_max_block_size = 16384, enable_mixed_granularity_parts = 1'
    );
  });
});
