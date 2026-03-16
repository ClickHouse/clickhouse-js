import { describe, it, expect, vi } from 'vitest'
import Stream from 'stream'
import { ResultSet } from '../../src'
import { guid } from '../../../client-common/__tests__/utils/guid'

describe('[Node.js] ResultSet (extra coverage)', () => {
  describe('json()', () => {
    it('should throw when calling json() with a non-JSON format', async () => {
      const rs = makeResultSet(
        Stream.Readable.from([Buffer.from('a,b,c\n1,2,3\n')]),
        'CSV',
      )
      await expect(rs.json()).rejects.toThrow('Cannot decode CSV as JSON')
    })

    it('should parse non-streamable JSON format (JSON)', async () => {
      const data = JSON.stringify({ data: [{ x: 1 }] })
      const rs = makeResultSet(
        Stream.Readable.from([Buffer.from(data)]),
        'JSON',
      )
      const result = await rs.json()
      expect(result).toEqual({ data: [{ x: 1 }] })
    })

    it('should parse non-streamable JSON format (JSONObjectEachRow)', async () => {
      const data = JSON.stringify({ row1: { x: 1 }, row2: { x: 2 } })
      const rs = makeResultSet(
        Stream.Readable.from([Buffer.from(data)]),
        'JSONObjectEachRow',
      )
      const result = await rs.json()
      expect(result).toEqual({ row1: { x: 1 }, row2: { x: 2 } })
    })
  })

  describe('close()', () => {
    it('should destroy the underlying stream', async () => {
      const stream = new Stream.Readable({
        read() {
          // never push data; the stream stays open
        },
      })
      // Attach an error listener to avoid unhandled error propagation
      stream.on('error', () => {
        // expected: ResultSet.close() destroys the stream with an error
      })
      const rs = makeResultSet(stream, 'JSONEachRow')

      expect(stream.destroyed).toBe(false)
      rs.close()
      expect(stream.destroyed).toBe(true)
    })
  })

  describe('stream()', () => {
    it('should throw when streaming a non-streamable format', () => {
      const rs = makeResultSet(
        Stream.Readable.from([Buffer.from('{}')]),
        'JSON',
      )
      expect(() => rs.stream()).toThrow(/JSON format is not streamable/)
    })
  })

  describe('constructor defaults', () => {
    it('should use console.error as default log_error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // noop
      })
      const errorStream = new Stream.Readable({
        read() {
          this.destroy(new Error('test stream error'))
        },
      })
      const rs = new ResultSet(
        errorStream,
        'JSONEachRow',
        guid(),
        // log_error omitted — should default to console.error
      )
      const pipelineStream = rs.stream()
      const done = new Promise<void>((resolve) => {
        pipelineStream.once('error', () => resolve())
        pipelineStream.once('close', () => resolve())
        pipelineStream.once('end', () => resolve())
      })
      // Consume the stream to trigger the pipeline error callback
      try {
        for await (const _ of pipelineStream) {
          // consume
        }
      } catch {
        // stream error expected
      }
      // Wait deterministically for the pipeline to complete before asserting
      await done
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should freeze response_headers', () => {
      const headers = { 'content-type': 'application/json' }
      const rs = ResultSet.instance({
        stream: Stream.Readable.from([]),
        format: 'JSONEachRow',
        query_id: guid(),
        log_error: () => {
          // noop
        },
        response_headers: headers,
      })
      expect(rs.response_headers).toEqual(headers)
      expect(Object.isFrozen(rs.response_headers)).toBe(true)
    })

    it('should have empty response_headers when not provided', () => {
      const rs = new ResultSet(Stream.Readable.from([]), 'JSONEachRow', guid())
      expect(rs.response_headers).toEqual({})
    })
  })
})

function makeResultSet(stream: Stream.Readable, format: string) {
  return ResultSet.instance({
    stream,
    format: format as any,
    query_id: guid(),
    log_error: () => {
      // noop
    },
    response_headers: {},
  })
}
