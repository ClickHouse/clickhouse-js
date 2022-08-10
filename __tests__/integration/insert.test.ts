import { expect } from 'chai';
import type { ResponseJSON } from '../../src';
import { type ClickHouseClient } from '../../src';
import { createTable, createTestClient, guid } from '../utils';

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(() => resolve({}), ms);
  });
}

describe('insert', () => {
  let client: ClickHouseClient;
  let tableName: string;
  beforeEach(async () => {
    client = await createTestClient();
    tableName = `test_table_${guid()}`;
    await createTable(client, (engine) => {
      return `
        CREATE TABLE ${tableName} 
        (id UInt64, name String, sku Array(UInt8))
        ${engine}
        ORDER BY (id)
      `;
    });
    await sleep(3000);
  });
  afterEach(async () => {
    await client.close();
  });

  it('inserts values as an array in a table', async () => {
    const dataToInsert = [
      [42, 'hello', [0, 1]],
      [43, 'world', [3, 4]],
    ];
    await client.insert({
      table: tableName,
      values: dataToInsert,
    });

    const Rows = await client.select({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSONEachRow',
    });

    const result = await Rows.json<ResponseJSON>();
    expect(result).to.deep.equal([
      { id: '42', name: 'hello', sku: [0, 1] },
      { id: '43', name: 'world', sku: [3, 4] },
    ]);
  });

  it('can insert strings with non-latin symbols', async () => {
    const dataToInsert = [
      [42, 'привет', [0, 1]],
      [43, 'мир', [3, 4]],
    ];
    await client.insert({
      table: tableName,
      values: dataToInsert,
    });

    const Rows = await client.select({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSONEachRow',
    });

    const result = await Rows.json<ResponseJSON>();
    expect(result).to.deep.equal([
      { id: '42', name: 'привет', sku: [0, 1] },
      { id: '43', name: 'мир', sku: [3, 4] },
    ]);
  });
});
