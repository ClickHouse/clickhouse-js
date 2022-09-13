import { createTableWithFields } from './fixtures/table_with_fields'
import type { ClickHouseClient } from '../../src'
import { createTestClient } from '../utils'

describe('DateTime', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  describe('Date', () => {
    it('should insert Date and get it back', async () => {
      // currently, there is no way to insert a Date as a number via HTTP
      // the conversion is not performed automatically like in VALUES clause
      const table = await createTableWithFields(client, 'd Date')
      await client.insert({
        table,
        values: [{ d: '2022-09-05' }],
        format: 'JSONEachRow',
      })

      expect(
        await client
          .query({
            query: `SELECT * EXCEPT id FROM ${table}`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
      ).toEqual([{ d: '2022-09-05' }])
    })
  })

  describe('Date32', () => {
    it('should insert Date32 and get it back', async () => {
      // currently, there is no way to insert a Date32 as a number via HTTP
      // the conversion is not performed automatically like in VALUES clause
      const table = await createTableWithFields(client, 'd Date32')
      await client.insert({
        table,
        values: [{ d: '2022-09-05' }],
        format: 'JSONEachRow',
      })

      expect(
        await client
          .query({
            query: `SELECT * EXCEPT id FROM ${table}`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
      ).toEqual([{ d: '2022-09-05' }])
    })
  })

  describe('DateTime', () => {
    it('should insert DateTime and get it back', async () => {
      const table = await createTableWithFields(client, 'd DateTime')
      await client.insert({
        table,
        values: [
          { d: 1662328969 }, // 2022-09-05 00:02:49 GMT+0200
          { d: '2022-09-05 00:02:49' }, // assumes column timezone (UTC by default)
        ],
        format: 'JSONEachRow',
      })

      expect(
        await client
          .query({
            query: `SELECT d FROM ${table}`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
      ).toEqual([
        { d: '2022-09-04 22:02:49' }, // converted to UTC on the server
        { d: '2022-09-05 00:02:49' }, // this one was assumed UTC upon insertion
      ])

      // toDateTime using Amsterdam timezone
      // should add 2 hours to each of the inserted dates
      expect(
        await client
          .query({
            query: `SELECT toDateTime(d, 'Europe/Amsterdam') AS d FROM ${table}`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
      ).toEqual([{ d: '2022-09-05 00:02:49' }, { d: '2022-09-05 02:02:49' }])
    })

    it('should insert DateTime and get it back (different timezone)', async () => {
      const table = await createTableWithFields(
        client,
        `d DateTime('Asia/Istanbul')`
      )
      await client.insert({
        table,
        values: [
          { d: 1662328969 }, // 2022-09-05 00:02:49 GMT+0200
          { d: '2022-09-05 00:02:49' }, // assumes column timezone (Asia/Istanbul)
        ],
        format: 'JSONEachRow',
      })

      expect(
        await client
          .query({
            query: `SELECT * EXCEPT id FROM ${table}`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
      ).toEqual([
        { d: '2022-09-05 01:02:49' }, // converted to Asia/Istanbul on the server
        { d: '2022-09-05 00:02:49' }, // this one was assumed Asia/Istanbul upon insertion
      ])

      // toDateTime using Amsterdam timezone
      // should subtract 1 hour from each of the inserted dates
      expect(
        await client
          .query({
            query: `SELECT toDateTime(d, 'Europe/Amsterdam') AS d FROM ${table}`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
      ).toEqual([{ d: '2022-09-05 00:02:49' }, { d: '2022-09-04 23:02:49' }])
    })
  })

  describe('DateTime64(3)', () => {
    it('should insert DateTime64(3) and get it back', async () => {
      const table = await createTableWithFields(client, 'd DateTime64(3)')
      await client.insert({
        table,
        values: [
          { d: 1662328969123 }, // 2022-09-05 00:02:49.123 GMT+0200
          { d: '2022-09-05 00:02:49.456' }, // assumes column timezone (UTC by default)
        ],
        format: 'JSONEachRow',
      })

      expect(
        await client
          .query({
            query: `SELECT * EXCEPT id FROM ${table}`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
      ).toEqual([
        { d: '2022-09-04 22:02:49.123' }, // converted to UTC on the server
        { d: '2022-09-05 00:02:49.456' }, // this one was assumed UTC upon insertion
      ])

      // toDateTime using Amsterdam timezone
      // should add 2 hours to each of the inserted dates
      expect(
        await client
          .query({
            query: `SELECT toDateTime64(d, 3, 'Europe/Amsterdam') AS d FROM ${table}`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
      ).toEqual([
        { d: '2022-09-05 00:02:49.123' },
        { d: '2022-09-05 02:02:49.456' },
      ])
    })

    it('should insert DateTime64(3) and get it back (different timezone)', async () => {
      const table = await createTableWithFields(
        client,
        `d DateTime64(3, 'Asia/Istanbul')`
      )
      await client.insert({
        table,
        values: [
          { d: 1662328969123 }, // 2022-09-05 00:02:49.123 GMT+0200
          { d: '2022-09-05 00:02:49.456' }, // assumes column timezone (Asia/Istanbul)
        ],
        format: 'JSONEachRow',
      })

      expect(
        await client
          .query({
            query: `SELECT * EXCEPT id FROM ${table}`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
      ).toEqual([
        { d: '2022-09-05 01:02:49.123' }, // converted to Asia/Istanbul on the server
        { d: '2022-09-05 00:02:49.456' }, // this one was assumed Asia/Istanbul upon insertion
      ])

      // toDateTime using Amsterdam timezone
      // should subtract 1 hour from each of the inserted dates
      expect(
        await client
          .query({
            query: `SELECT toDateTime64(d, 3, 'Europe/Amsterdam') AS d FROM ${table}`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json())
      ).toEqual([
        { d: '2022-09-05 00:02:49.123' },
        { d: '2022-09-04 23:02:49.456' },
      ])
    })
  })
})
