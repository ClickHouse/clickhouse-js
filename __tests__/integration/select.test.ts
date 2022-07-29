import { expect } from 'chai';
import Stream from 'stream';
import { createClient, type ClickHouseClient, type Row, type ClickHouseError } from '../../src';
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
    expect(response).to.equal('0\n1\n');
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
    expect(response).to.equal('3\n4\n5\n');
  });

  it('does not swallow a client error', (done) => {
    client = createClient({});

    client.select({ query: 'SELECT number FR' })
      .catch((e: ClickHouseError) => {
        expect(e.type).to.equal('UNKNOWN_IDENTIFIER');
        done();
      });
  });

  it('returns an error details provided by ClickHouse', (done) => {
    client = createClient();
    client.select({ query: ';' })
      .catch((e: ClickHouseError) => {
        expect(e.message).to.be.a('string');
        expect(e.message).to.have.lengthOf.above(0);
        expect(e.code).to.equal('62');
        expect(e.type).to.equal('SYNTAX_ERROR');
        done();
      });
  });

  describe('select result', () => {
    describe('text()', function() {
      it('returns values from SELECT query in specified format', async() => {
        client = createClient();
        const Rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 3',
          format: 'CSV'
        });

        expect(await Rows.text()).to.equal('0\n1\n2\n');
      });
      it('returns values from SELECT query in specified format', async() => {
        client = createClient();
        const Rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 3',
          format: 'JSONEachRow'
        });

        expect(await Rows.text()).to.equal('{"number":"0"}\n{"number":"1"}\n{"number":"2"}\n');
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
        expect(nums).to.be.an('array');
        expect(nums).to.have.length(5);
        const values = nums.map(i => i.number);
        expect(values).to.deep.equal(['0', '1', '2', '3', '4']);
      });

      it('returns columns data in response', async() => {
        client = createClient();
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON'
        });

        const { meta } = await rows.json<ResponseJSON<{number: string}>>();

        expect(meta?.length).to.equal(1);

        const column = meta![0];
        expect(column).to.deep.equal({
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

        expect(response.rows).to.equal(5);
      });

      it('returns statistics in response', async() => {
        client = createClient();
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON'
        });

        const response = await rows.json<ResponseJSON<{number: string}>>();

        expect(response.statistics).to.have.own.property('elapsed');
        expect(response.statistics?.elapsed).to.be.a('number');
        expect(response.statistics).to.have.own.property('rows_read');
        expect(response.statistics?.rows_read).to.be.a('number');
        expect(response.statistics).to.have.own.property('bytes_read');
        expect(response.statistics?.bytes_read).to.be.a('number');
      });

      it.skip('returns queryId in response', async() => {
        client = createClient();
        const rows = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON'
        });

        const response = await rows.json<ResponseJSON<{number: string}>>();

        expect(response.query_id).to.be.a('number');
      });
    });
  });

  describe('select result asStream()', () => {
    it('throws an exception if format is not stream-able', async () => {
      client = createClient();
      const result = await client.select({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSON'
      });
      try{
        expect(() => result.asStream()).to.throw('JSON format is not streamable');
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
      expect(last).to.equal('9999')
    });

    describe('text()', () => {
      it('returns stream of rows in CSV format', async () => {
        client = createClient();
        const result = await client.select({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'CSV'
        });

        const rows = await rowsText(result.asStream());

        expect(rows).to.deep.equal([
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

        expect(rows).to.deep.equal([
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

        expect(rows).to.deep.equal([
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

        expect(rows).to.deep.equal([
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

        expect(rows).to.deep.equal([
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

        expect(rows).to.deep.equal([
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

        expect(rows).to.deep.equal([
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

        expect(rows).to.deep.equal([
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

        expect(rows).to.deep.equal([
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
