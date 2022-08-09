import { expect } from 'chai';
import { parseError, ClickHouseError } from '../../src/error';

describe('parseError', () => {
  it('parses a single line error', () => {
    const message = `Code: 62.DB::Exception: Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table FORMAT JSON. Expected alias cannot be here. (SYNTAX_ERROR) (version 22.7.1.2484 (official build))`;
    const error = parseError(message) as ClickHouseError;

    expect(error).to.be.instanceof(ClickHouseError);
    expect(error.code).to.equal('62');
    expect(error.type).to.equal('SYNTAX_ERROR');
    expect(error.message).to.equal(
      `Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table FORMAT JSON. Expected alias cannot be here. `
    );
  });

  it('parses a multiline error', () => {
    const message = `Code: 62.DB::Exception: Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table
    FORMAT JSON. Expected alias cannot be here. (SYNTAX_ERROR) (version 22.7.1.2484 (official build))`;
    const error = parseError(message) as ClickHouseError;

    expect(error).to.be.instanceof(ClickHouseError);
    expect(error.code).to.equal('62');
    expect(error.type).to.equal('SYNTAX_ERROR');
    expect(error.message).to
      .equal(`Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table
    FORMAT JSON. Expected alias cannot be here. `);
  });

  it('should handle replica message corner case', () => {
    const message = `Code: 285. DB::Exception: Number of alive replicas (2) is less than requested quorum (3). (TOO_FEW_LIVE_REPLICAS) (version 22.8.1.11291 (official build))`;
    const error = parseError(message) as ClickHouseError;

    expect(error).to.be.instanceof(ClickHouseError);
    expect(error.code).to.equal('285');
    expect(error.type).to.equal('TOO_FEW_LIVE_REPLICAS');
    expect(error.message).to.equal(
      'Number of alive replicas (2) is less than requested quorum (3). '
    );
  });

  describe('error codes with numbers', () => {
    it('should work with S3_ERROR', () => {
      const message = `Code: 499. DB::Exception: Could not list objects in bucket my-bucket with prefix my-organization, S3 exception: Some S3 error, message: Could not list objects. (S3_ERROR) (version 22.8.1.11291 (official build))`;
      const error = parseError(message) as ClickHouseError;

      expect(error).to.be.instanceof(ClickHouseError);
      expect(error.code).to.equal('499');
      expect(error.type).to.equal('S3_ERROR');
      expect(error.message).to.equal(
        'Could not list objects in bucket my-bucket with prefix my-organization, S3 exception: Some S3 error, message: Could not list objects. '
      );
    });

    it('should work with BZIP2_STREAM_DECODER_FAILED', () => {
      const message = `Code: 594. DB::Exception: bzip2 stream encoder init failed: error code: 42 (BZIP2_STREAM_DECODER_FAILED) (version 22.8.1.11291 (official build))`;
      const error = parseError(message) as ClickHouseError;

      expect(error).to.be.instanceof(ClickHouseError);
      expect(error.code).to.equal('594');
      expect(error.type).to.equal('BZIP2_STREAM_DECODER_FAILED');
      expect(error.message).to.equal(
        'bzip2 stream encoder init failed: error code: 42 '
      );
    });

    it('should work with LZ4_ENCODER_FAILED', () => {
      const message = `Code: 617. DB::Exception: creation of LZ4 compression context failed. LZ4F version: 1.9.3 (LZ4_ENCODER_FAILED) (version 22.8.1.11291 (official build))`;
      const error = parseError(message) as ClickHouseError;

      expect(error).to.be.instanceof(ClickHouseError);
      expect(error.code).to.equal('617');
      expect(error.type).to.equal('LZ4_ENCODER_FAILED');
      expect(error.message).to.equal(
        'creation of LZ4 compression context failed. LZ4F version: 1.9.3 '
      );
    });
  });
});
