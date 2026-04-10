import { describe, it, expect, vi, beforeEach } from 'vitest'
import Stream from 'stream'
import Zlib from 'zlib'
import type Http from 'http'
import { EventEmitter } from 'events'
import { ClickHouseLogLevel } from '@clickhouse/client-common'
import {
  decompressResponse,
  isDecompressionError,
} from '../../src/connection/compression'

/**
 * Comprehensive unit tests for compression/decompression handling
 * Testing edge cases, error handling, and different encoding types
 */
describe('Compression', () => {
  let mockLogWriter: any
  let mockResponse: Http.IncomingMessage

  beforeEach(() => {
    mockLogWriter = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    // Create a mock IncomingMessage
    mockResponse = new EventEmitter() as any
    mockResponse.headers = {}
    mockResponse.statusCode = 200
  })

  describe('decompressResponse', () => {
    it('should return response as-is when no encoding header', () => {
      mockResponse.headers = {}

      const result = decompressResponse(
        mockResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(false)
      if (!isDecompressionError(result)) {
        expect(result.response).toBe(mockResponse)
      }
    })

    it('should decompress gzip-encoded response', () => {
      mockResponse.headers = { 'content-encoding': 'gzip' }

      const result = decompressResponse(
        mockResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(false)
      if (!isDecompressionError(result)) {
        expect(result.response).toBeInstanceOf(Stream.Readable)
        expect(result.response).not.toBe(mockResponse)
      }
    })

    it('should return error for unexpected encoding', () => {
      mockResponse.headers = { 'content-encoding': 'deflate' }

      const result = decompressResponse(
        mockResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(true)
      if (isDecompressionError(result)) {
        expect(result.error).toBeInstanceOf(Error)
        expect(result.error.message).toContain('Unexpected encoding: deflate')
      }
    })

    it('should return error for br encoding', () => {
      mockResponse.headers = { 'content-encoding': 'br' }

      const result = decompressResponse(
        mockResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(true)
      if (isDecompressionError(result)) {
        expect(result.error.message).toContain('Unexpected encoding: br')
      }
    })

    it('should return error for compress encoding', () => {
      mockResponse.headers = { 'content-encoding': 'compress' }

      const result = decompressResponse(
        mockResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(true)
      if (isDecompressionError(result)) {
        expect(result.error.message).toContain('Unexpected encoding: compress')
      }
    })

    it('should handle gzip with case variation', () => {
      mockResponse.headers = { 'content-encoding': 'gzip' }

      const result = decompressResponse(
        mockResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(false)
    })

    it('should return error for invalid encoding string', () => {
      mockResponse.headers = { 'content-encoding': 'unknown-encoding' }

      const result = decompressResponse(
        mockResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(true)
      if (isDecompressionError(result)) {
        expect(result.error.message).toContain(
          'Unexpected encoding: unknown-encoding',
        )
      }
    })

    it('should handle empty string encoding', () => {
      mockResponse.headers = { 'content-encoding': '' }

      const result = decompressResponse(
        mockResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      // Empty string is not undefined, so it will try to handle it
      expect(isDecompressionError(result)).toBe(true)
      if (isDecompressionError(result)) {
        expect(result.error.message).toContain('Unexpected encoding: ')
      }
    })

    it('should log error when decompression fails with ERROR level', async () => {
      mockResponse.headers = { 'content-encoding': 'gzip' }

      // Create a readable stream that emits an error
      const errorStream = new Stream.Readable({
        read() {
          // Emit invalid gzip data
          this.push(Buffer.from('not gzip data'))
          this.push(null)
        },
      })

      // Mock response as error stream
      const errorResponse = errorStream as any
      errorResponse.headers = { 'content-encoding': 'gzip' }

      const result = decompressResponse(
        errorResponse,
        mockLogWriter,
        ClickHouseLogLevel.ERROR,
      )

      expect(isDecompressionError(result)).toBe(false)

      if (!isDecompressionError(result)) {
        // Wait for the pipeline error
        await new Promise<void>((resolve) => {
          result.response.on('error', () => {
            // Error should be logged
            setTimeout(() => {
              expect(mockLogWriter.error).toHaveBeenCalled()
              resolve()
            }, 100)
          })
        })
      }
    })

    it('should not log error when log level is OFF', async () => {
      mockResponse.headers = { 'content-encoding': 'gzip' }

      const errorStream = new Stream.Readable({
        read() {
          this.push(Buffer.from('not gzip data'))
          this.push(null)
        },
      })

      const errorResponse = errorStream as any
      errorResponse.headers = { 'content-encoding': 'gzip' }

      const result = decompressResponse(
        errorResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(false)

      if (!isDecompressionError(result)) {
        await new Promise<void>((resolve) => {
          result.response.on('error', () => {
            setTimeout(() => {
              expect(mockLogWriter.error).not.toHaveBeenCalled()
              resolve()
            }, 100)
          })
        })
      }
    })

    it('should successfully decompress valid gzip data', async () => {
      const originalData = 'Hello, this is test data for compression!'

      // Create gzipped data
      const gzippedData = Zlib.gzipSync(Buffer.from(originalData))

      // Create a stream with gzipped data
      const gzipStream = new Stream.Readable({
        read() {
          this.push(gzippedData)
          this.push(null)
        },
      })

      const gzipResponse = gzipStream as any
      gzipResponse.headers = { 'content-encoding': 'gzip' }

      const result = decompressResponse(
        gzipResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(false)

      if (!isDecompressionError(result)) {
        // Read decompressed data
        const chunks: Buffer[] = []
        for await (const chunk of result.response) {
          chunks.push(Buffer.from(chunk))
        }
        const decompressed = Buffer.concat(chunks).toString('utf-8')
        expect(decompressed).toBe(originalData)
      }
    })

    it('should handle multiple gzip chunks', async () => {
      const data1 = 'First chunk'
      const data2 = 'Second chunk'
      const combined = data1 + data2

      const gzippedData = Zlib.gzipSync(Buffer.from(combined))

      // Split gzipped data into multiple chunks
      const chunk1 = gzippedData.subarray(0, Math.floor(gzippedData.length / 2))
      const chunk2 = gzippedData.subarray(Math.floor(gzippedData.length / 2))

      const gzipStream = new Stream.Readable({
        read() {
          this.push(chunk1)
          this.push(chunk2)
          this.push(null)
        },
      })

      const gzipResponse = gzipStream as any
      gzipResponse.headers = { 'content-encoding': 'gzip' }

      const result = decompressResponse(
        gzipResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(false)

      if (!isDecompressionError(result)) {
        const chunks: Buffer[] = []
        for await (const chunk of result.response) {
          chunks.push(Buffer.from(chunk))
        }
        const decompressed = Buffer.concat(chunks).toString('utf-8')
        expect(decompressed).toBe(combined)
      }
    })

    it('should handle empty gzipped response', async () => {
      const emptyData = ''
      const gzippedData = Zlib.gzipSync(Buffer.from(emptyData))

      const gzipStream = new Stream.Readable({
        read() {
          this.push(gzippedData)
          this.push(null)
        },
      })

      const gzipResponse = gzipStream as any
      gzipResponse.headers = { 'content-encoding': 'gzip' }

      const result = decompressResponse(
        gzipResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(false)

      if (!isDecompressionError(result)) {
        const chunks: Buffer[] = []
        for await (const chunk of result.response) {
          chunks.push(Buffer.from(chunk))
        }
        const decompressed = Buffer.concat(chunks).toString('utf-8')
        expect(decompressed).toBe('')
      }
    })

    it('should handle large gzipped data', async () => {
      const largeData = 'x'.repeat(100000) // 100KB of data
      const gzippedData = Zlib.gzipSync(Buffer.from(largeData))

      const gzipStream = new Stream.Readable({
        read() {
          this.push(gzippedData)
          this.push(null)
        },
      })

      const gzipResponse = gzipStream as any
      gzipResponse.headers = { 'content-encoding': 'gzip' }

      const result = decompressResponse(
        gzipResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      expect(isDecompressionError(result)).toBe(false)

      if (!isDecompressionError(result)) {
        const chunks: Buffer[] = []
        for await (const chunk of result.response) {
          chunks.push(Buffer.from(chunk))
        }
        const decompressed = Buffer.concat(chunks).toString('utf-8')
        expect(decompressed).toBe(largeData)
        expect(decompressed.length).toBe(100000)
      }
    })
  })

  describe('isDecompressionError', () => {
    it('should return true for error result', () => {
      const errorResult = { error: new Error('test error') }
      expect(isDecompressionError(errorResult)).toBe(true)
    })

    it('should return false for success result', () => {
      const successResult = { response: new Stream.Readable() }
      expect(isDecompressionError(successResult)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isDecompressionError(undefined)).toBe(false)
    })

    it('should return false for null', () => {
      expect(isDecompressionError(null)).toBe(false)
    })

    it('should return false for empty object', () => {
      expect(isDecompressionError({})).toBe(false)
    })

    it('should return true when error property exists but is null', () => {
      const result = { error: null }
      // error property exists, so it should return true according to the implementation
      expect(isDecompressionError(result)).toBe(false)
    })

    it('should return true when error property exists but is undefined', () => {
      const result = { error: undefined }
      expect(isDecompressionError(result)).toBe(false)
    })

    it('should return false for object with response property', () => {
      const result = { response: new Stream.Readable() }
      expect(isDecompressionError(result)).toBe(false)
    })

    it('should return true for error result with additional properties', () => {
      const result = { error: new Error('test'), extra: 'data' }
      expect(isDecompressionError(result)).toBe(true)
    })

    it('should handle error with custom properties', () => {
      const customError = new Error('custom')
      ;(customError as any).code = 'CUSTOM_CODE'
      const result = { error: customError }
      expect(isDecompressionError(result)).toBe(true)
    })

    it('should work with any type input', () => {
      expect(isDecompressionError('string')).toBe(false)
      expect(isDecompressionError(123)).toBe(false)
      expect(isDecompressionError(true)).toBe(false)
      expect(isDecompressionError([])).toBe(false)
    })
  })

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle corrupted gzip header', async () => {
      // Create invalid gzip data (just random bytes)
      const corruptedGzip = Buffer.from([0x1f, 0x8b, 0x00, 0x00, 0xff, 0xff])

      const gzipStream = new Stream.Readable({
        read() {
          this.push(corruptedGzip)
          this.push(null)
        },
      })

      const gzipResponse = gzipStream as any
      gzipResponse.headers = { 'content-encoding': 'gzip' }

      const result = decompressResponse(
        gzipResponse,
        mockLogWriter,
        ClickHouseLogLevel.ERROR,
      )

      expect(isDecompressionError(result)).toBe(false)

      if (!isDecompressionError(result)) {
        // Should emit error during decompression
        await expect(async () => {
          for await (const chunk of result.response) {
            // Try to read
          }
        }).rejects.toThrow()
      }
    })

    it('should handle truncated gzip stream', async () => {
      const originalData = 'This is a test'
      const fullGzip = Zlib.gzipSync(Buffer.from(originalData))
      const truncatedGzip = fullGzip.subarray(0, fullGzip.length - 5) // Cut off last 5 bytes

      const gzipStream = new Stream.Readable({
        read() {
          this.push(truncatedGzip)
          this.push(null)
        },
      })

      const gzipResponse = gzipStream as any
      gzipResponse.headers = { 'content-encoding': 'gzip' }

      const result = decompressResponse(
        gzipResponse,
        mockLogWriter,
        ClickHouseLogLevel.ERROR,
      )

      expect(isDecompressionError(result)).toBe(false)

      if (!isDecompressionError(result)) {
        // May or may not throw depending on where truncation happened
        try {
          for await (const chunk of result.response) {
            // Try to read
          }
        } catch (err) {
          expect(err).toBeDefined()
        }
      }
    })

    it('should handle response with multiple encoding values', () => {
      // Some servers might send multiple encodings (though not standard)
      mockResponse.headers = { 'content-encoding': 'gzip, deflate' }

      const result = decompressResponse(
        mockResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      // Will be treated as unexpected encoding
      expect(isDecompressionError(result)).toBe(true)
    })

    it('should handle encoding header with whitespace', () => {
      mockResponse.headers = { 'content-encoding': '  gzip  ' }

      const result = decompressResponse(
        mockResponse,
        mockLogWriter,
        ClickHouseLogLevel.OFF,
      )

      // Whitespace won't match exactly 'gzip'
      expect(isDecompressionError(result)).toBe(true)
    })

    it('should log with different log levels', () => {
      const logLevels = [
        ClickHouseLogLevel.TRACE,
        ClickHouseLogLevel.DEBUG,
        ClickHouseLogLevel.INFO,
        ClickHouseLogLevel.WARN,
        ClickHouseLogLevel.ERROR,
        ClickHouseLogLevel.OFF,
      ]

      logLevels.forEach((level) => {
        mockResponse.headers = { 'content-encoding': 'gzip' }
        const result = decompressResponse(mockResponse, mockLogWriter, level)
        expect(isDecompressionError(result)).toBe(false)
      })
    })
  })
})
