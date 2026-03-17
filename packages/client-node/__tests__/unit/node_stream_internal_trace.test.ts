import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DefaultLogger,
  LogWriter,
  ClickHouseLogLevel,
} from '@clickhouse/client-common'
import { drainStreamInternal, type Context } from '../../src/connection/stream'
import { Readable } from 'stream'

const nextTick = () => new Promise((resolve) => process.nextTick(resolve))

describe('drainStreamInternal (TRACE logging)', () => {
  let traceSpy: ReturnType<typeof vi.spyOn>
  let log_writer: LogWriter
  let context: Context

  beforeEach(() => {
    const logger = new DefaultLogger()
    traceSpy = vi.spyOn(logger, 'trace')
    log_writer = new LogWriter(logger, 'Connection', ClickHouseLogLevel.TRACE)
    context = {
      op: 'Insert',
      query_id: 'trace-test-query-id',
      log_writer,
      log_level: ClickHouseLogLevel.TRACE,
    }
  })

  it('should log starting stream drain and stream drain completed on end', async () => {
    const readable = new Readable({
      read() {
        this.push('data')
        this.push(null)
      },
    })

    await expect(
      drainStreamInternal(context, readable),
    ).resolves.toBeUndefined()

    const calls = traceSpy.mock.calls.map((c) => c[0].message)
    expect(calls).toContain('Insert: starting stream drain')
    expect(calls).toContain('Insert: received data chunk during drain')
    expect(calls).toContain('Insert: stream drain completed (end event)')
  })

  it('should log chunk details when receiving data during drain', async () => {
    const readable = new Readable({
      read() {
        this.push('hello')
        this.push('world')
        this.push(null)
      },
    })

    await expect(
      drainStreamInternal(context, readable),
    ).resolves.toBeUndefined()

    const chunkCalls = traceSpy.mock.calls.filter(
      (c) => c[0].message === 'Insert: received data chunk during drain',
    )
    expect(chunkCalls.length).toBeGreaterThanOrEqual(1)
    expect(chunkCalls[0][0].args).toEqual(
      expect.objectContaining({
        query_id: 'trace-test-query-id',
        chunk_number: 1,
        chunk_size: expect.any(Number),
        total_bytes_received: expect.any(Number),
      }),
    )
  })

  it('should log stream already errored before drain', async () => {
    const readable = new Readable({
      read() {
        this.emit('error', new Error('Pre-existing error'))
      },
    })

    try {
      for await (const _ of readable) {
        // consume the stream to trigger the error
      }
    } catch {
      // expected
    }

    await expect(drainStreamInternal(context, readable)).rejects.toThrow()

    const calls = traceSpy.mock.calls.map((c) => c[0].message)
    expect(calls).toContain('Insert: starting stream drain')
    expect(calls).toContain('Insert: stream already errored before drain')
  })

  it('should log stream already ended before drain', async () => {
    const readable = new Readable({
      read() {
        this.push('data')
        this.push(null)
      },
    })

    for await (const _ of readable) {
      // consume the stream
    }

    await expect(
      drainStreamInternal(context, readable),
    ).resolves.toBeUndefined()

    const calls = traceSpy.mock.calls.map((c) => c[0].message)
    expect(calls).toContain('Insert: starting stream drain')
    expect(calls).toContain('Insert: stream already ended before drain')
  })

  it('should log stream already closed before drain', async () => {
    const readable = new Readable({
      emitClose: true,
      read() {
        this.push('data')
      },
    })

    readable.destroy()
    await nextTick()

    await expect(
      drainStreamInternal(context, readable),
    ).resolves.toBeUndefined()

    const calls = traceSpy.mock.calls.map((c) => c[0].message)
    expect(calls).toContain('Insert: starting stream drain')
    expect(calls).toContain('Insert: stream already closed before drain')
  })

  it('should log stream drain failed on error event', async () => {
    const readable = new Readable({
      read() {
        this.emit('error', new Error('Stream error during drain'))
      },
    })

    await expect(drainStreamInternal(context, readable)).rejects.toThrow(
      'Stream error during drain',
    )

    const calls = traceSpy.mock.calls.map((c) => c[0].message)
    expect(calls).toContain('Insert: starting stream drain')
    expect(calls).toContain('Insert: stream drain failed (error event)')

    const errorCall = traceSpy.mock.calls.find(
      (c) => c[0].message === 'Insert: stream drain failed (error event)',
    )
    expect(errorCall![0].args).toEqual(
      expect.objectContaining({
        query_id: 'trace-test-query-id',
        error: 'Stream error during drain',
      }),
    )
  })

  it('should log stream closed during drain on close event', async () => {
    const readable = new Readable({
      emitClose: true,
      read() {
        // don't push any data; the stream will be destroyed externally
      },
    })

    const drainPromise = drainStreamInternal(context, readable)
    // Need a tick for the stream listeners to be attached
    await nextTick()
    readable.destroy()

    await expect(drainPromise).resolves.toBeUndefined()

    const calls = traceSpy.mock.calls.map((c) => c[0].message)
    expect(calls).toContain('Insert: starting stream drain')
    expect(calls).toContain('Insert: stream closed during drain (close event)')
  })

  it('should include stream state in the starting drain log', async () => {
    const readable = new Readable({
      read() {
        this.push(null)
      },
    })

    await drainStreamInternal(context, readable)

    const startCall = traceSpy.mock.calls.find(
      (c) => c[0].message === 'Insert: starting stream drain',
    )
    expect(startCall).toBeDefined()
    expect(startCall![0].args).toEqual(
      expect.objectContaining({
        query_id: 'trace-test-query-id',
        stream_state: expect.objectContaining({
          readable: expect.any(Boolean),
          readableEnded: expect.any(Boolean),
          readableLength: expect.any(Number),
        }),
      }),
    )
  })

  it('should include duration and totals in the end log', async () => {
    const readable = new Readable({
      read() {
        this.push('some data')
        this.push(null)
      },
    })

    await drainStreamInternal(context, readable)

    const endCall = traceSpy.mock.calls.find(
      (c) => c[0].message === 'Insert: stream drain completed (end event)',
    )
    expect(endCall).toBeDefined()
    expect(endCall![0].args).toEqual(
      expect.objectContaining({
        query_id: 'trace-test-query-id',
        duration_ms: expect.any(Number),
        total_bytes_received: expect.any(Number),
        total_chunks: expect.any(Number),
      }),
    )
  })
})
