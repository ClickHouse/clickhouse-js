import { parseError, ClickHouseError } from '../../src/error'

describe('parseError', () => {
  it('parses a single line error', () => {
    const message = `Code: 62.DB::Exception: Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table FORMAT JSON. Expected alias cannot be here. (SYNTAX_ERROR) (version 22.7.1.2484 (official build))`
    const error = parseError(message) as ClickHouseError

    expect(error).toBeInstanceOf(ClickHouseError)
    expect(error.code).toBe('62')
    expect(error.type).toBe('SYNTAX_ERROR')
    expect(error.message).toBe(
      `Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table FORMAT JSON. Expected alias cannot be here. `
    )
  })

  it('parses a multiline error', () => {
    const message = `Code: 62.DB::Exception: Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table
    FORMAT JSON. Expected alias cannot be here. (SYNTAX_ERROR) (version 22.7.1.2484 (official build))`
    const error = parseError(message) as ClickHouseError

    expect(error).toBeInstanceOf(ClickHouseError)
    expect(error.code).toBe('62')
    expect(error.type).toBe('SYNTAX_ERROR')
    expect(error.message).toBe(
      `Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table
    FORMAT JSON. Expected alias cannot be here. `
    )
  })

  it('should handle replica message corner case', () => {
    const message = `Code: 285. DB::Exception: Number of alive replicas (2) is less than requested quorum (3). (TOO_FEW_LIVE_REPLICAS) (version 22.8.1.11291 (official build))`
    const error = parseError(message) as ClickHouseError

    expect(error).toBeInstanceOf(ClickHouseError)
    expect(error.code).toBe('285')
    expect(error.type).toBe('TOO_FEW_LIVE_REPLICAS')
    expect(error.message).toBe(
      'Number of alive replicas (2) is less than requested quorum (3). '
    )
  })

  describe('error codes with numbers', () => {
    it('should work with S3_ERROR', () => {
      const message = `Code: 499. DB::Exception: Could not list objects in bucket my-bucket with prefix my-organization, S3 exception: Some S3 error, message: Could not list objects. (S3_ERROR) (version 22.8.1.11291 (official build))`
      const error = parseError(message) as ClickHouseError

      expect(error).toBeInstanceOf(ClickHouseError)
      expect(error.code).toBe('499')
      expect(error.type).toBe('S3_ERROR')
      expect(error.message).toBe(
        'Could not list objects in bucket my-bucket with prefix my-organization, S3 exception: Some S3 error, message: Could not list objects. '
      )
    })

    it('should work with BZIP2_STREAM_DECODER_FAILED', () => {
      const message = `Code: 594. DB::Exception: bzip2 stream encoder init failed: error code: 42 (BZIP2_STREAM_DECODER_FAILED) (version 22.8.1.11291 (official build))`
      const error = parseError(message) as ClickHouseError

      expect(error).toBeInstanceOf(ClickHouseError)
      expect(error.code).toBe('594')
      expect(error.type).toBe('BZIP2_STREAM_DECODER_FAILED')
      expect(error.message).toBe(
        'bzip2 stream encoder init failed: error code: 42 '
      )
    })

    it('should work with LZ4_ENCODER_FAILED', () => {
      const message = `Code: 617. DB::Exception: creation of LZ4 compression context failed. LZ4F version: 1.9.3 (LZ4_ENCODER_FAILED) (version 22.8.1.11291 (official build))`
      const error = parseError(message) as ClickHouseError

      expect(error).toBeInstanceOf(ClickHouseError)
      expect(error.code).toBe('617')
      expect(error.type).toBe('LZ4_ENCODER_FAILED')
      expect(error.message).toBe(
        'creation of LZ4 compression context failed. LZ4F version: 1.9.3 '
      )
    })
  })

  describe('Cluster mode errors', () => {
    // FIXME: https://github.com/ClickHouse/clickhouse-js/issues/39
    it.skip('should work with TABLE_ALREADY_EXISTS', async () => {
      const message = `Code: 57. DB::Exception: There was an error on [clickhouse2:9000]: Code: 57. DB::Exception: Table default.command_test_2a751694160745f5aebe586c90b27515 already exists. (TABLE_ALREADY_EXISTS) (version 22.6.5.22 (official build)). (TABLE_ALREADY_EXISTS) (version 22.6.5.22 (official build))`
      const error = parseError(message) as ClickHouseError

      expect(error).toBeInstanceOf(ClickHouseError)
      expect(error.code).toBe('57')
      expect(error.type).toBe('TABLE_ALREADY_EXISTS')
      expect(error.message).toBe(
        'Table default.command_test_2a751694160745f5aebe586c90b27515 already exists. '
      )
    })
  })
})
