import { isProgress } from '@clickhouse/client-common'

describe('ClickHouse types', () => {
  it('should check if a row is progress row', async () => {
    const row = {
      progress: {
        read_rows: '1',
        read_bytes: '1',
        written_rows: '1',
        written_bytes: '1',
        total_rows_to_read: '1',
        result_rows: '1',
        result_bytes: '1',
        elapsed_ns: '1',
      },
    }
    expect(isProgress(row)).toBeTruthy()
    expect(isProgress({})).toBeFalsy()
    expect(
      isProgress({
        ...row,
        extra: 'extra',
      }),
    ).toBeFalsy()
    expect(isProgress(null)).toBeFalsy()
  })
})
