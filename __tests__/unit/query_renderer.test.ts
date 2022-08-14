import * as ch from '../../src/schema';
import { MergeTree } from '../../src/schema';
import { QueryRenderer } from '../../src/schema/query_renderer';

describe('QueryRenderer', () => {
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
      QueryRenderer.createTable(tableOptions, { engine: MergeTree() })
    ).toEqual(
      'CREATE TABLE my_table (foo String, bar UInt8) ENGINE MergeTree()'
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
      QueryRenderer.createTable(tableOptions, {
        engine: MergeTree(),
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
