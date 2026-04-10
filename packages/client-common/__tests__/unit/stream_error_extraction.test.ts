import { describe, it, expect } from 'vitest'
import Stream from 'stream'
import {
  extractErrorAtTheEndOfChunk,
  CARET_RETURN,
} from '../../src/utils/stream'

/**
 * Comprehensive unit tests for stream error extraction
 * Testing edge cases, malformed markers, and multi-byte characters
 */
describe('Stream Error Extraction', () => {
  const EXCEPTION_MARKER = '__exception__'

  describe('extractErrorAtTheEndOfChunk', () => {
    it('should extract error from well-formed chunk', () => {
      const exceptionTag = 'test-tag'
      const errorMessage = 'Database error occurred'
      const errorLen = errorMessage.length + 1 // +1 for newline

      // Format: <error message>\n<length> __exception__\r\n<tag>\r\n
      const chunk = Buffer.from(
        `${errorMessage}\n${errorLen} ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('Database error occurred')
    })

    it('should handle multi-line error messages', () => {
      const exceptionTag = 'err-123'
      const errorMessage = 'Error line 1\nError line 2\nError line 3'
      const errorLen = errorMessage.length + 1

      const chunk = Buffer.from(
        `${errorMessage}\n${errorLen} ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('Error line 1')
      expect(error.message).toContain('Error line 2')
      expect(error.message).toContain('Error line 3')
    })

    it('should handle error with multi-byte UTF-8 characters', () => {
      const exceptionTag = 'unicode-test'
      const errorMessage = 'Ошибка базы данных 🔥💥' // Russian text + emojis
      const errorLen = Buffer.from(errorMessage, 'utf-8').length + 1

      const chunk = Buffer.from(
        `${errorMessage}\n${errorLen} ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('Ошибка базы данных')
      expect(error.message).toContain('🔥')
    })

    it('should return error when chunk is too small', () => {
      const exceptionTag = 'tag'
      const chunk = Buffer.from('err', 'utf-8') // Too small

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('malformed')
    })

    it('should return error when error length is NaN', () => {
      const exceptionTag = 'test'
      // Invalid length (not a number)
      const chunk = Buffer.from(
        `error\nNOT_A_NUMBER ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('failed to parse the message length')
    })

    it('should return error when error length is zero', () => {
      const exceptionTag = 'test'
      const chunk = Buffer.from(
        `error\n0 ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('failed to parse the message length')
    })

    it('should return error when error length is negative', () => {
      const exceptionTag = 'test'
      const chunk = Buffer.from(
        `error\n-5 ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('failed to parse the message length')
    })

    it('should handle chunk cut by proxy (incomplete exception marker)', () => {
      const exceptionTag = 'test'
      // Incomplete marker - simulating proxy cutting the chunk
      const chunk = Buffer.from(`error\n10 __excep`, 'utf-8')

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      // Should catch the error in try-catch and return it
      expect(error).toBeInstanceOf(Error)
    })

    it('should handle missing newline before error length', () => {
      const exceptionTag = 'test'
      const errorMessage = 'error message'
      // Missing newline before error length
      const chunk = Buffer.from(
        `${errorMessage}15 ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      // Will likely fail to find newline or parse incorrectly
      expect(error).toBeInstanceOf(Error)
    })

    it('should handle error message with special characters', () => {
      const exceptionTag = 'special-chars'
      const errorMessage = 'Error: \r\n\t"quotes" <tags> & symbols'
      const errorLen = Buffer.from(errorMessage, 'utf-8').length + 1

      const chunk = Buffer.from(
        `${errorMessage}\n${errorLen} ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('quotes')
      expect(error.message).toContain('tags')
    })

    it('should handle very long exception tag', () => {
      const exceptionTag = 'a'.repeat(100) // Very long tag
      const errorMessage = 'error'
      const errorLen = errorMessage.length + 1

      const chunk = Buffer.from(
        `${errorMessage}\n${errorLen} ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
    })

    it('should handle empty error message', () => {
      const exceptionTag = 'test'
      const errorMessage = ''
      const errorLen = 1 // Just the newline

      const chunk = Buffer.from(
        `${errorMessage}\n${errorLen} ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
    })

    it('should handle chunk with only exception marker and tag', () => {
      const exceptionTag = 'minimal'
      // Minimal valid chunk
      const chunk = Buffer.from(
        `err\n4 ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
    })

    it('should handle error length with leading/trailing spaces', () => {
      const exceptionTag = 'test'
      const errorMessage = 'error'
      // Length with spaces
      const chunk = Buffer.from(
        `${errorMessage}\n  10  ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      // parseInt should handle spaces
      expect(error).toBeInstanceOf(Error)
    })

    it('should handle malformed UTF-8 in error message', () => {
      const exceptionTag = 'test'
      // Create a buffer with invalid UTF-8 sequence
      const errorBytes = Buffer.from([0xff, 0xfe, 0xfd]) // Invalid UTF-8
      const errorLen = errorBytes.length + 1

      const chunks = [
        errorBytes,
        Buffer.from(`\n${errorLen} ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`),
      ]
      const chunk = Buffer.concat(chunks)

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      // Should handle gracefully even with invalid UTF-8
      expect(error).toBeInstanceOf(Error)
    })

    it('should handle exception marker appearing multiple times', () => {
      const exceptionTag = 'test'
      const errorMessage = `Previous ${EXCEPTION_MARKER} in message`
      const errorLen = Buffer.from(errorMessage, 'utf-8').length + 1

      // Exception marker appears in both error message and at the end
      const chunk = Buffer.from(
        `${errorMessage}\n${errorLen} ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
      // Should parse correctly and include the marker in the message
      expect(error.message).toContain('Previous')
    })

    it('should handle chunk with binary data before error', () => {
      const exceptionTag = 'binary-test'
      const errorMessage = 'Error after binary'
      const errorLen = errorMessage.length + 1

      // Binary data followed by error
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04])
      const errorPart = Buffer.from(
        `${errorMessage}\n${errorLen} ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
      )
      const chunk = Buffer.concat([binaryData, errorPart])

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('Error after binary')
    })

    it('should handle extremely large error length value', () => {
      const exceptionTag = 'test'
      const errorMessage = 'error'
      const largeLen = Number.MAX_SAFE_INTEGER

      const chunk = Buffer.from(
        `${errorMessage}\n${largeLen} ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      // Should handle gracefully (likely will return error about subarray bounds)
      expect(error).toBeInstanceOf(Error)
    })

    it('should handle chunk ending with incomplete newline sequence', () => {
      const exceptionTag = 'test'
      // Chunk ending with \r but no \n
      const chunk = Buffer.from(
        `error\n10 ${EXCEPTION_MARKER}\r\n${exceptionTag}\r`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
    })

    it('should handle Windows-style line endings in error message', () => {
      const exceptionTag = 'windows'
      const errorMessage = 'Error line 1\r\nError line 2\r\n'
      const errorLen = Buffer.from(errorMessage, 'utf-8').length + 1

      const chunk = Buffer.from(
        `${errorMessage}\n${errorLen} ${EXCEPTION_MARKER}\r\n${exceptionTag}\r\n`,
        'utf-8',
      )

      const error = extractErrorAtTheEndOfChunk(chunk, exceptionTag)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('Error line 1')
      expect(error.message).toContain('Error line 2')
    })
  })

  describe('CARET_RETURN constant', () => {
    it('should have correct value for carriage return', () => {
      expect(CARET_RETURN).toBe(0x0d)
      expect(CARET_RETURN).toBe(13)
      expect(String.fromCharCode(CARET_RETURN)).toBe('\r')
    })
  })
})
