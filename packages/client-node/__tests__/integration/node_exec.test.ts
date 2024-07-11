import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'
import { guid } from '@test/utils'
import { createSimpleTable } from '@test/fixtures/simple_table'
import Stream from 'stream'
import { getAsText } from '../../src/utils'
import { drainStream, ResultSet } from '../../src'

describe('[Node.js] exec', () => {
  let client: ClickHouseClient<Stream.Readable>
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('should send a parametrized query', async () => {
    const result = await client.exec({
      query: 'SELECT plus({val1: Int32}, {val2: Int32})',
      query_params: {
        val1: 10,
        val2: 20,
      },
    })
    expect(await getAsText(result.stream)).toEqual('30\n')
  })

  describe('trailing semi', () => {
    it('should allow commands with semi in select clause', async () => {
      const result = await client.exec({
        query: `SELECT ';' FORMAT CSV`,
      })
      expect(await getAsText(result.stream)).toEqual('";"\n')
    })

    it('should allow commands with trailing semi', async () => {
      const result = await client.exec({
        query: 'EXISTS system.databases;',
      })
      expect(await getAsText(result.stream)).toEqual('1\n')
    })

    it('should allow commands with multiple trailing semi', async () => {
      const result = await client.exec({
        query: 'EXISTS system.foobar;;;;;;',
      })
      expect(await getAsText(result.stream)).toEqual('0\n')
    })

    it('should work with default_format', async () => {
      const format = 'JSONEachRow'
      const { stream, query_id } = await client.exec({
        query: 'SELECT number FROM system.numbers LIMIT 1',
        clickhouse_settings: {
          default_format: format,
        },
      })
      const rs = ResultSet.instance({
        stream,
        format,
        query_id,
        log_error: (err) => {
          console.error(err)
        },
        response_headers: {},
      })
      expect(await rs.json()).toEqual([{ number: '0' }])
    })
  })

  describe('custom insert streaming with exec', () => {
    let tableName: string
    beforeEach(async () => {
      tableName = `test_node_exec_insert_stream_${guid()}`
      await createSimpleTable(client, tableName)
    })

    it('should send an insert stream', async () => {
      const stream = Stream.Readable.from(['42,foobar,"[1,2]"'], {
        objectMode: false,
      })
      const execResult = await client.exec({
        query: `INSERT INTO ${tableName} FORMAT CSV`,
        values: stream,
      })
      // the result stream contains nothing useful for an insert and should be immediately drained to release the socket
      await drainStream(execResult.stream)
      await checkInsertedValues([
        {
          id: '42',
          name: 'foobar',
          sku: [1, 2],
        },
      ])
    })

    it('should not fail with an empty stream', async () => {
      const stream = new Stream.Readable({
        read() {
          // required
        },
        objectMode: false,
      })
      const execPromise = client.exec({
        query: `INSERT INTO ${tableName} FORMAT CSV`,
        values: stream,
      })
      // close the empty stream after the request is sent
      stream.push(null)
      // the result stream contains nothing useful for an insert and should be immediately drained to release the socket
      const execResult = await execPromise
      await drainStream(execResult.stream)
      await checkInsertedValues([])
    })

    it('should not fail with an already closed stream', async () => {
      const stream = new Stream.Readable({
        read() {
          // required
        },
        objectMode: false,
      })
      stream.push('42,foobar,"[1,2]"\n')
      // close the stream with some values
      stream.push(null)
      const execResult = await client.exec({
        query: `INSERT INTO ${tableName} FORMAT CSV`,
        values: stream,
      })
      // the result stream contains nothing useful for an insert and should be immediately drained to release the socket
      await drainStream(execResult.stream)
      await checkInsertedValues([
        {
          id: '42',
          name: 'foobar',
          sku: [1, 2],
        },
      ])
    })

    it('should not fail with an empty and already closed stream', async () => {
      const stream = new Stream.Readable({
        read() {
          // required
        },
        objectMode: false,
      })
      // close the empty stream immediately
      stream.push(null)
      const execResult = await client.exec({
        query: `INSERT INTO ${tableName} FORMAT CSV`,
        values: stream,
      })
      // the result stream contains nothing useful for an insert and should be immediately drained to release the socket
      await drainStream(execResult.stream)
      await checkInsertedValues([])
    })

    async function checkInsertedValues<T = unknown>(expected: Array<T>) {
      const rs = await client.query({
        query: `SELECT * FROM ${tableName}`,
        format: 'JSONEachRow',
      })
      expect(await rs.json()).toEqual(expected)
    }
  })
})
