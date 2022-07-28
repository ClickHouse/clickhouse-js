import Stream from 'stream';
import { createClient, type ClickHouseClient, type Row } from '../../src';
import type { ResponseJSON } from '../../src/clickhouse_types';

async function rowsValues(stream: Stream.Readable): Promise<any[]> {
  const result: any[] = [];
  for await (const chunk of stream) {
    result.push((chunk as Row).json());
  }
  return result;
}

async function rowsText(stream: Stream.Readable): Promise<string[]> {
  const result: string[] = [];
  for await (const chunk of stream) {
    result.push((chunk as Row).text());
  }
  return result;
}

describe('select', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it('can specify settings in select', async () => {
    client = createClient();
    const rows = await client.select({
      query: 'SELECT number FROM system.numbers LIMIT 5',
      format: 'CSV',
      clickhouse_settings: {
        limit: 2
      }
    });

    const response = await rows.text();
    expect(response).toBe('0\n1\n');
  });

  it('can specify a parameterized query', async () => {
    client = createClient();
    const rows = await client.select({
      query: 'SELECT number FROM system.numbers WHERE number > {min_limit: UInt64} LIMIT 3',
      format: 'CSV',
      query_params: {
        min_limit: 2
      }
    });

    const response = await rows.text();
    expect(response).toBe('3\n4\n5\n');
  });

  it('does not swallow a client error', async() => {
    expect.assertions(1);
    client = createClient({
      host: 'http://localhost:3333'
    });

    try {
      await client.select({ query: 'SELECT number FROM system.numbers WHERE number > {min_limit: UInt64} LIMIT 3' });
    } catch (e: any) {
      expect(e.message).toMatch(/connect ECONNREFUSED/);
    }
  });

  it('returns an error details provided by ClickHouse', async() => {
    expect.assertions(4);
    client = createClient();
    try {
      await client.select({
        query: ';'
      });
    } catch (e: any) {
      expect(e.message).toEqual(expect.any(String));
      expect(e.message.length > 0).toBe(true);
      expect(e.code).toBe('62');
      expect(e.type).toBe('SYNTAX_ERROR');
    }
  });

  describe('select result', () => {
    describe('text()', function() {
      it('returns values from SELECT query in specified format', async() => {
        client = createClient();
        const Rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 3',
          format: 'CSV'
        });

        expect(await Rows.text()).toMatchInlineSnapshot(`
  "0
  1
  2
  "
  `);
      });
      it('returns values from SELECT query in specified format', async() => {
        client = createClient();
        const Rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 3',
          format: 'JSONEachRow'
        });

        expect(await Rows.text()).toMatchInlineSnapshot(`
  "{\\"number\\":\\"0\\"}
  {\\"number\\":\\"1\\"}
  {\\"number\\":\\"2\\"}
  "
  `);
      });
    });

    describe('json()', () => {
      it('returns an array of values in data property', async() => {
        client = createClient();
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON'
        });

        const { data: nums } = await rows.json<ResponseJSON<{number: string}>>();
        expect(nums).toBeInstanceOf(Array);
        expect(nums.length).toBe(5);
        const values = nums.map(i => i.number);
        expect(values).toEqual(['0', '1', '2', '3', '4']);
      });

      it('returns columns data in response', async() => {
        client = createClient();
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON'
        });

        const { meta } = await rows.json<ResponseJSON<{number: string}>>();

        expect(meta?.length).toBe(1);

        const column = meta![0];
        expect(column).toEqual({
          name: 'number',
          type: 'UInt64'
        });
      });

      it('returns number of rows in response', async() => {
        client = createClient();
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON'
        });

        const response = await rows.json<ResponseJSON<{number: string}>>();

        expect(response.rows).toBe(5);
      });

      it('returns statistics in response', async() => {
        client = createClient();
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON'
        });

        const response = await rows.json<ResponseJSON<{number: string}>>();

        expect(response.statistics).toEqual(
          expect.objectContaining({
            elapsed: expect.any(Number),
            rows_read: expect.any(Number),
            bytes_read: expect.any(Number),
          })
        );
      });

      it.skip('returns queryId in response', async() => {
        client = createClient();
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON'
        });

        const response = await rows.json<ResponseJSON<{number: string}>>();

        expect(response.query_id).toEqual(expect.any(Number));
      });
    });
  });

  describe('select result asStream()', () => {
    it('throws an exception if format is not stream-able', async () => {
      expect.assertions(1);
      client = createClient();
      const result = await client.select({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSON'
      });
      try{
        expect(() => result.asStream()).toThrowError('JSON format is not streamable');
      } finally {
        result.close();
      }
    });

    it('can pause response stream', async() => {
      client = createClient();
      const result = await client.select({
        query: 'SELECT number FROM system.numbers LIMIT 10000',
        format: 'CSV'
      });

      const stream = result.asStream();

      let last = null;
      let i = 0;
      for await (const chunk of stream) {
        last = chunk.text();
        i++;
        if(i % 1000 === 0) {
          stream.pause();
          setTimeout(() => stream.resume(), 100);
        }
      }
      expect(last).toEqual('9999')
    });

    describe('text()', () => {
      it('returns stream of rows in CSV format', async () => {
        client = createClient();
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'CSV'
        });

        const rows = await rowsText(result.asStream());

        expect(rows).toEqual([
          '0',
          '1',
          '2',
          '3',
          '4'
        ]);
      });

      it('returns stream of rows in TabSeparated format', async () => {
        client = createClient();
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'TabSeparated'
        });

        const rows = await rowsText(result.asStream());

        expect(rows).toEqual([
          '0',
          '1',
          '2',
          '3',
          '4'
        ]);
      });
    });

    describe('json()', () => {
      it('returns stream of objects in JSONEachRow format', async () => {
        client = createClient();
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONEachRow'
        });

        const rows = await rowsValues(result.asStream());

        expect(rows).toEqual([
          [ { number: '0' } ],
          [ { number: '1' } ],
          [ { number: '2' } ],
          [ { number: '3' } ],
          [ { number: '4' } ],
        ]);
      });

      it('returns stream of objects in JSONStringsEachRow format', async () => {
        client = createClient();
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONStringsEachRow'
        });

        const rows = await rowsValues(result.asStream());

        expect(rows).toEqual([
          [ { number: '0' } ],
          [ { number: '1' } ],
          [ { number: '2' } ],
          [ { number: '3' } ],
          [ { number: '4' } ],
        ]);
      });

      it('returns stream of objects in JSONCompactEachRow format', async () => {
        client = createClient();
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactEachRow'
        });

        const rows = await rowsValues(result.asStream());

        expect(rows).toEqual([
          [ ['0'] ],
          [ ['1'] ],
          [ ['2'] ],
          [ ['3'] ],
          [ ['4'] ]
        ]);
      });

      it('returns stream of objects in JSONCompactEachRowWithNames format', async () => {
        client = createClient();
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactEachRowWithNames'
        });

        const rows = await rowsValues(result.asStream());

        expect(rows).toEqual([
          [ ['number'] ],
          [ ['0'] ],
          [ ['1'] ],
          [ ['2'] ],
          [ ['3'] ],
          [ ['4'] ]
        ]);
      });

      it('returns stream of objects in JSONCompactEachRowWithNamesAndTypes format', async () => {
        client = createClient();
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactEachRowWithNamesAndTypes'
        });

        const rows = await rowsValues(result.asStream());

        expect(rows).toEqual([
          [ ['number'] ],
          [ ['UInt64'] ],
          [ ['0'] ],
          [ ['1'] ],
          [ ['2'] ],
          [ ['3'] ],
          [ ['4'] ]
        ]);
      });

      it('returns stream of objects in JSONCompactStringsEachRowWithNames format', async () => {
        client = createClient();
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactStringsEachRowWithNames'
        });

        const rows = await rowsValues(result.asStream());

        expect(rows).toEqual([
          [ ['number'] ],
          [ ['0'] ],
          [ ['1'] ],
          [ ['2'] ],
          [ ['3'] ],
          [ ['4'] ]
        ]);
      });

      it('returns stream of objects in JSONCompactStringsEachRowWithNamesAndTypes format', async () => {
        client = createClient();
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactStringsEachRowWithNamesAndTypes'
        });

        const rows = await rowsValues(result.asStream());

        expect(rows).toEqual([
          [ ['number'] ],
          [ ['UInt64'] ],
          [ ['0'] ],
          [ ['1'] ],
          [ ['2'] ],
          [ ['3'] ],
          [ ['4'] ]
        ]);
      });
    });
  });
});
