import { expect } from 'chai';

import { type ClickHouseClient } from '../../src';
import { createTestClient } from '../utils';

describe('select with query binding', () => {
  let client: ClickHouseClient;
  beforeEach(() => {
    client = createTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  it('can specify a parameterized query', async () => {
    const rows = await client.select({
      query:
        'SELECT number FROM system.numbers WHERE number > {min_limit: UInt64} LIMIT 3',
      format: 'CSV',
      query_params: {
        min_limit: 2,
      },
    });

    const response = await rows.text();
    expect(response).to.equal('3\n4\n5\n');
  });

  it('handles boolean in a parameterized query', async () => {
    const rows1 = await client.select({
      query: 'SELECT and({val1: Boolean}, {val2: Boolean})',
      format: 'CSV',
      query_params: {
        val1: true,
        val2: true,
      },
    });

    expect(await rows1.text()).to.equal('true\n');

    const rows2 = await client.select({
      query: 'SELECT and({val1: Boolean}, {val2: Boolean})',
      format: 'CSV',
      query_params: {
        val1: true,
        val2: false,
      },
    });

    expect(await rows2.text()).to.equal('false\n');
  });

  it('handles numbers in a parameterized query', async () => {
    const rows = await client.select({
      query: 'SELECT plus({val1: Int32}, {val2: Int32})',
      format: 'CSV',
      query_params: {
        val1: 10,
        val2: 20,
      },
    });

    expect(await rows.text()).to.equal('30\n');
  });

  it('handles Dates in a parameterized query', async () => {
    const rows = await client.select({
      query: 'SELECT toDateTime({min_time: DateTime})',
      format: 'CSV',
      query_params: {
        min_time: new Date(2022, 4, 2),
      },
    });

    const response = await rows.text();
    expect(response).to.equal('"2022-05-02 00:00:00"\n');
  });

  it('handles an array of strings in a parameterized query', async () => {
    const rows = await client.select({
      query: 'SELECT arrayConcat({arr1: Array(String)}, {arr2: Array(String)})',
      format: 'CSV',
      query_params: {
        arr1: ['1', '2'],
        arr2: ['3', '4'],
      },
    });

    const response = await rows.text();
    expect(response).to.equal(`"['1','2','3','4']"\n`);
  });

  it('handles an array of numbers in a parameterized query', async () => {
    const rows = await client.select({
      query: 'SELECT arrayConcat({arr1: Array(Int32)}, {arr2: Array(Int32)})',
      format: 'CSV',
      query_params: {
        arr1: [1, 2],
        arr2: [3, 4],
      },
    });

    const response = await rows.text();
    expect(response).to.equal(`"[1,2,3,4]"\n`);
  });

  it('escapes strings in a parameterized query', async () => {
    const rows = await client.select({
      query: 'SELECT concat({str1: String},{str2: String})',
      format: 'CSV',
      query_params: {
        str1: "co'n",
        str2: "ca't",
      },
    });

    const response = await rows.text();
    expect(response).to.equal('"co\'nca\'t"\n');
  });

  it('handles an object a parameterized query', async () => {
    const rows = await client.select({
      query: 'SELECT mapKeys({obj: Map(String, UInt32)})',
      format: 'CSV',
      query_params: {
        obj: { id: 42 },
      },
    });

    const response = await rows.text();
    expect(response).to.equal(`"['id']"\n`);
  });
});
