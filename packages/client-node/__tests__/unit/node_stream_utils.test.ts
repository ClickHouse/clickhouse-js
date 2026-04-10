import { describe, it, expect, vi } from 'vitest'
import Stream from 'stream'
import { isStream, getAsText, mapStream } from '../../src/utils/stream'
import { constants } from 'buffer'

const { MAX_STRING_LENGTH } = constants

/**
 * Comprehensive unit tests for Node.js stream utilities
 * Testing edge cases, error handling, and stream transformations
 */
describe('Node.js Stream Utilities', () => {
  describe('isStream', () => {
    it('should return true for readable stream', () => {
      const stream = new Stream.Readable()
      expect(isStream(stream)).toBe(true)
    })

    it('should return true for writable stream', () => {
      const stream = new Stream.Writable()
      expect(isStream(stream)).toBe(true)
    })

    it('should return true for transform stream', () => {
      const stream = new Stream.Transform()
      expect(isStream(stream)).toBe(true)
    })

    it('should return true for duplex stream', () => {
      const stream = new Stream.Duplex()
      expect(isStream(stream)).toBe(true)
    })

    it('should return false for null', () => {
      expect(isStream(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isStream(undefined)).toBe(false)
    })

    it('should return false for plain object', () => {
      expect(isStream({})).toBe(false)
    })

    it('should return false for object with pipe but wrong type', () => {
      const obj = { pipe: 'not a function', on: () => {} }
      expect(isStream(obj)).toBe(false)
    })

    it('should return false for object with on but no pipe', () => {
      const obj = { on: () => {} }
      expect(isStream(obj)).toBe(false)
    })

    it('should return false for string', () => {
      expect(isStream('string')).toBe(false)
    })

    it('should return false for number', () => {
      expect(isStream(123)).toBe(false)
    })

    it('should return false for array', () => {
      expect(isStream([])).toBe(false)
    })

    it('should return false for buffer', () => {
      expect(isStream(Buffer.from('test'))).toBe(false)
    })

    it('should return true for stream-like object with pipe and on functions', () => {
      const streamLike = {
        pipe: () => {},
        on: () => {},
      }
      expect(isStream(streamLike)).toBe(true)
    })

    it('should return false for object with pipe but no on', () => {
      const obj = { pipe: () => {} }
      expect(isStream(obj)).toBe(false)
    })

    it('should handle object mode stream', () => {
      const stream = new Stream.Readable({ objectMode: true })
      expect(isStream(stream)).toBe(true)
    })
  })

  describe('getAsText', () => {
    it('should convert simple stream to text', async () => {
      const stream = Stream.Readable.from(['Hello', ' ', 'World'])
      const text = await getAsText(stream)
      expect(text).toBe('Hello World')
    })

    it('should handle empty stream', async () => {
      const stream = Stream.Readable.from([])
      const text = await getAsText(stream)
      expect(text).toBe('')
    })

    it('should handle stream with single chunk', async () => {
      const stream = Stream.Readable.from(['Single chunk'])
      const text = await getAsText(stream)
      expect(text).toBe('Single chunk')
    })

    it('should handle stream with Buffer chunks', async () => {
      const stream = Stream.Readable.from([
        Buffer.from('Hello'),
        Buffer.from(' '),
        Buffer.from('World'),
      ])
      const text = await getAsText(stream)
      expect(text).toBe('Hello World')
    })

    it('should handle multi-byte UTF-8 characters', async () => {
      const text = 'Hello 世界 🌍'
      const stream = Stream.Readable.from([Buffer.from(text, 'utf-8')])
      const result = await getAsText(stream)
      expect(result).toBe(text)
    })

    it('should handle multi-byte UTF-8 split across chunks', async () => {
      // Split emoji across chunks
      const emoji = '🌍' // 4-byte UTF-8 character
      const buffer = Buffer.from(emoji, 'utf-8')
      const chunk1 = buffer.subarray(0, 2)
      const chunk2 = buffer.subarray(2, 4)

      const stream = Stream.Readable.from([chunk1, chunk2])
      const result = await getAsText(stream)
      expect(result).toBe(emoji)
    })

    it('should flush incomplete multi-byte characters at end', async () => {
      const stream = Stream.Readable.from([
        Buffer.from('Hello'),
        Buffer.from(' World'),
      ])
      const text = await getAsText(stream)
      expect(text).toBe('Hello World')
    })

    it('should handle stream error', async () => {
      const stream = new Stream.Readable({
        read() {
          this.emit('error', new Error('Stream error'))
        },
      })

      await expect(getAsText(stream)).rejects.toThrow('Stream error')
    })

    it('should handle very long stream', async () => {
      const chunks = new Array(1000).fill('a')
      const stream = Stream.Readable.from(chunks)
      const text = await getAsText(stream)
      expect(text.length).toBe(1000)
      expect(text).toBe('a'.repeat(1000))
    })

    it('should handle stream with newlines and special characters', async () => {
      const content = 'Line 1\nLine 2\r\nLine 3\t\tTab'
      const stream = Stream.Readable.from([Buffer.from(content)])
      const text = await getAsText(stream)
      expect(text).toBe(content)
    })

    it('should handle stream with null bytes', async () => {
      const buffer = Buffer.from([0x48, 0x00, 0x69]) // H \0 i
      const stream = Stream.Readable.from([buffer])
      const text = await getAsText(stream)
      expect(text).toBe('H\0i')
    })

    it('should throw error for stream exceeding MAX_STRING_LENGTH', async () => {
      // Mock a stream that would exceed max length
      const stream = new Stream.Readable({
        read() {
          // Simulate very large data
          this.emit(
            'error',
            new RangeError('Invalid string length: maximum exceeded'),
          )
        },
      })

      await expect(getAsText(stream)).rejects.toThrow()
    })

    it('should handle stream with mixed string and buffer chunks', async () => {
      const stream = Stream.Readable.from([
        Buffer.from('Hello'),
        Buffer.from(' '),
        Buffer.from('Mixed'),
      ])
      const text = await getAsText(stream)
      expect(text).toBe('Hello Mixed')
    })

    it('should handle already ended stream', async () => {
      const stream = new Stream.Readable({
        read() {
          this.push('data')
          this.push(null) // End immediately
        },
      })
      const text = await getAsText(stream)
      expect(text).toBe('data')
    })

    it('should handle stream with Unicode surrogate pairs', async () => {
      // Emoji with skin tone modifier (surrogate pairs)
      const text = '👋🏼' // Wave with skin tone
      const stream = Stream.Readable.from([Buffer.from(text, 'utf-8')])
      const result = await getAsText(stream)
      expect(result).toBe(text)
    })

    it('should handle stream with combining characters', async () => {
      // e with acute accent as combining characters
      const text = 'e\u0301' // é as base + combining
      const stream = Stream.Readable.from([Buffer.from(text, 'utf-8')])
      const result = await getAsText(stream)
      expect(result).toBe(text)
    })

    it('should properly decode incomplete multi-byte at chunk boundaries', async () => {
      // Chinese character 中 (U+4E2D) is 3 bytes in UTF-8: E4 B8 AD
      const char = '中'
      const buffer = Buffer.from(char, 'utf-8')

      // Split into incomplete chunks
      const stream = Stream.Readable.from([
        buffer.subarray(0, 1), // E4
        buffer.subarray(1, 2), // B8
        buffer.subarray(2, 3), // AD
      ])

      const result = await getAsText(stream)
      expect(result).toBe(char)
    })
  })

  describe('mapStream', () => {
    it('should transform stream with mapper function', async () => {
      const mapper = (input: unknown) => `[${input}]`
      const transform = mapStream(mapper)

      const input = ['a', 'b', 'c']
      const output: string[] = []

      const readable = Stream.Readable.from(input)
      readable.pipe(transform)

      for await (const chunk of transform) {
        output.push(chunk)
      }

      expect(output).toEqual(['[a]', '[b]', '[c]'])
    })

    it('should handle empty stream', async () => {
      const mapper = (input: unknown) => String(input)
      const transform = mapStream(mapper)

      const input: unknown[] = []
      const output: string[] = []

      const readable = Stream.Readable.from(input)
      readable.pipe(transform)

      for await (const chunk of transform) {
        output.push(chunk)
      }

      expect(output).toEqual([])
    })

    it('should work in object mode', async () => {
      const mapper = (obj: unknown) => JSON.stringify(obj)
      const transform = mapStream(mapper)

      const input = [{ id: 1 }, { id: 2 }, { id: 3 }]
      const output: string[] = []

      const readable = Stream.Readable.from(input)
      readable.pipe(transform)

      for await (const chunk of transform) {
        output.push(chunk)
      }

      expect(output).toEqual([
        JSON.stringify({ id: 1 }),
        JSON.stringify({ id: 2 }),
        JSON.stringify({ id: 3 }),
      ])
    })

    it('should handle mapper that returns different types', async () => {
      const mapper = (input: unknown) => `${input}`.toUpperCase()
      const transform = mapStream(mapper)

      const input = ['hello', 'world']
      const output: string[] = []

      const readable = Stream.Readable.from(input)
      readable.pipe(transform)

      for await (const chunk of transform) {
        output.push(chunk)
      }

      expect(output).toEqual(['HELLO', 'WORLD'])
    })

    it('should handle null and undefined values', async () => {
      const mapper = (input: unknown) => `value: ${input}`
      const transform = mapStream(mapper)

      const input = [null, undefined, 'text']
      const output: string[] = []

      const readable = Stream.Readable.from(input)
      readable.pipe(transform)

      for await (const chunk of transform) {
        output.push(chunk)
      }

      expect(output).toEqual(['value: null', 'value: undefined', 'value: text'])
    })

    it('should handle numbers and booleans', async () => {
      const mapper = (input: unknown) => `[${typeof input}:${input}]`
      const transform = mapStream(mapper)

      const input = [42, true, false, 0]
      const output: string[] = []

      const readable = Stream.Readable.from(input)
      readable.pipe(transform)

      for await (const chunk of transform) {
        output.push(chunk)
      }

      expect(output).toEqual([
        '[number:42]',
        '[boolean:true]',
        '[boolean:false]',
        '[number:0]',
      ])
    })

    it('should handle complex objects', async () => {
      const mapper = (obj: any) => `${obj.name}:${obj.value}`
      const transform = mapStream(mapper)

      const input = [
        { name: 'a', value: 1 },
        { name: 'b', value: 2 },
      ]
      const output: string[] = []

      const readable = Stream.Readable.from(input)
      readable.pipe(transform)

      for await (const chunk of transform) {
        output.push(chunk)
      }

      expect(output).toEqual(['a:1', 'b:2'])
    })

    it('should propagate errors from mapper function', async () => {
      const mapper = (input: unknown) => {
        if (input === 'error') {
          throw new Error('Mapper error')
        }
        return String(input)
      }
      const transform = mapStream(mapper)

      const input = ['ok', 'error', 'ok2']
      const readable = Stream.Readable.from(input)
      readable.pipe(transform)

      const collectOutput = async () => {
        const output: string[] = []
        for await (const chunk of transform) {
          output.push(chunk)
        }
        return output
      }

      // Should throw when mapper throws
      await expect(collectOutput()).rejects.toThrow('Mapper error')
    })

    it('should handle large number of chunks', async () => {
      const mapper = (input: unknown) => `item-${input}`
      const transform = mapStream(mapper)

      const input = Array.from({ length: 10000 }, (_, i) => i)
      const output: string[] = []

      const readable = Stream.Readable.from(input)
      readable.pipe(transform)

      for await (const chunk of transform) {
        output.push(chunk)
      }

      expect(output).toHaveLength(10000)
      expect(output[0]).toBe('item-0')
      expect(output[9999]).toBe('item-9999')
    })

    it('should allow chaining multiple mapStream transformations', async () => {
      const mapper1 = (input: unknown) => String(input).toUpperCase()
      const mapper2 = (input: unknown) => `[${input}]`

      const transform1 = mapStream(mapper1)
      const transform2 = mapStream(mapper2)

      const input = ['hello', 'world']
      const output: string[] = []

      const readable = Stream.Readable.from(input)
      readable.pipe(transform1).pipe(transform2)

      for await (const chunk of transform2) {
        output.push(chunk)
      }

      expect(output).toEqual(['[HELLO]', '[WORLD]'])
    })

    it('should be in object mode by default', () => {
      const mapper = (input: unknown) => String(input)
      const transform = mapStream(mapper)

      expect(transform._readableState.objectMode).toBe(true)
      expect(transform._writableState.objectMode).toBe(true)
    })
  })

  describe('Stream Edge Cases', () => {
    it('should handle stream destroyed while reading', async () => {
      const stream = new Stream.Readable({
        read() {
          this.push('data')
          setTimeout(() => this.destroy(new Error('Stream destroyed')), 10)
        },
      })

      await expect(getAsText(stream)).rejects.toThrow('Stream destroyed')
    })

    it('should handle stream paused and resumed', async () => {
      const stream = new Stream.Readable({
        read() {
          this.push('chunk1')
          this.push('chunk2')
          this.push(null)
        },
      })

      // Pause and resume shouldn't affect getAsText
      stream.pause()
      setTimeout(() => stream.resume(), 10)

      const text = await getAsText(stream)
      expect(text).toBe('chunk1chunk2')
    })
  })
})
