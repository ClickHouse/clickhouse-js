import { describe, it, expect } from 'vitest'
import { isException, isProgressRow, isRow } from '@clickhouse/client-common'

describe('ClickHouse types', () => {
  it('should check if a row is progress row', async () => {
    const row = {
      progress: {
        read_rows: '1',
        read_bytes: '1',
        elapsed_ns: '1',
      },
    }
    expect(isProgressRow(row)).toBeTruthy()
    expect(isProgressRow({})).toBeFalsy()
    expect(
      isProgressRow({
        ...row,
        extra: 'extra',
      }),
    ).toBeFalsy()
    expect(isProgressRow(null)).toBeFalsy()
    expect(isProgressRow(undefined)).toBeFalsy()
    expect(isProgressRow(42)).toBeFalsy()
    expect(isProgressRow({ foo: 'bar' })).toBeFalsy()
  })

  it('should check if a row is a data row', async () => {
    const row = { row: { foo: 'bar' } }
    expect(isRow(row)).toBeTruthy()
    expect(
      isRow({
        ...row,
        extra: 'extra',
      }),
    ).toBeFalsy()
    expect(isRow(null)).toBeFalsy()
    expect(isRow(undefined)).toBeFalsy()
    expect(isRow(42)).toBeFalsy()
    expect(isRow({ foo: 'bar' })).toBeFalsy()
  })

  it('should check if a row has an exception', async () => {
    const row = { exception: 'Some error occurred' }
    expect(isException(row)).toBeTruthy()
    expect(
      isException({
        ...row,
        extra: 'extra',
      }),
    ).toBeFalsy()
    expect(isException(null)).toBeFalsy()
    expect(isException(undefined)).toBeFalsy()
    expect(isException(42)).toBeFalsy()
    expect(isException({ foo: 'bar' })).toBeFalsy()
    expect(isException({ progress: { read_rows: '1' } })).toBeFalsy()
  })
})
