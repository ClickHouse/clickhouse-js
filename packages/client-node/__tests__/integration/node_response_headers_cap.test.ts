import http from 'http'
import net, { type AddressInfo } from 'net'
import { describe, it } from 'vitest'

// Verifies the behavior of Node.js' built-in http client when parsing responses
// with a large block of response headers, depending on the `maxHeaderSize`
// option. A raw TCP server is used to bypass Node's own server-side header
// limit and emit a hand-crafted HTTP/1.1 response, mirroring the experiment
// captured in the test plan.
//
// This is a pure Node.js behavior check; the ClickHouse client is intentionally
// not involved here.
describe('[Node.js] http client maxHeaderSize behavior', () => {
  // Build enough X-H-NNNN headers to roughly reach `targetBytes`.
  function makeHeaders(
    targetBytes: number,
  ): Array<{ name: string; value: string }> {
    const headers: Array<{ name: string; value: string }> = []
    let total = 0
    let i = 0
    while (total < targetBytes) {
      const name = `X-H-${String(i).padStart(4, '0')}`
      const value = 'a'.repeat(90)
      headers.push({ name, value })
      total += name.length + 2 /* ": " */ + value.length + 2 /* CRLF */
      i++
    }
    return headers
  }

  // Raw TCP server that replies with a fixed HTTP/1.1 response containing
  // the supplied headers. Bypasses Node's own server header limit entirely.
  async function startServer(
    headers: Array<{ name: string; value: string }>,
  ): Promise<[net.Server, number]> {
    const server = net.createServer((socket) => {
      socket.once('data', () => {
        const body = 'OK'
        const headerBlob = headers
          .map((h) => `${h.name}: ${h.value}\r\n`)
          .join('')
        const response =
          'HTTP/1.1 200 OK\r\n' +
          `Content-Length: ${body.length}\r\n` +
          headerBlob +
          '\r\n' +
          body
        socket.write(response)
        socket.end()
      })
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    return [server, (server.address() as AddressInfo).port]
  }

  type ClientResult =
    | { ok: true; headerCount: number; firstValue: string; lastValue: string }
    | { ok: false; code?: string; message: string }

  function tryClient(
    port: number,
    firstName: string,
    lastName: string,
    maxHeaderSize?: number,
  ): Promise<ClientResult> {
    return new Promise((resolve) => {
      const opts: http.RequestOptions = {
        hostname: '127.0.0.1',
        port,
        path: '/',
      }
      if (maxHeaderSize !== undefined) {
        opts.maxHeaderSize = maxHeaderSize
      }
      const req = http.request(opts, (res) => {
        const first = res.headers[firstName.toLowerCase()] as string | undefined
        const last = res.headers[lastName.toLowerCase()] as string | undefined
        res.on('data', () => {})
        res.on('end', () =>
          resolve({
            ok: true,
            headerCount: Object.keys(res.headers).length,
            firstValue: first ?? '',
            lastValue: last ?? '',
          }),
        )
      })
      req.on('error', (e: NodeJS.ErrnoException) =>
        resolve({ ok: false, code: e.code, message: e.message }),
      )
      req.end()
    })
  }

  async function runScenario(params: {
    payloadKB: number
    maxHeaderSize?: number
  }): Promise<{
    result: ClientResult
    headerCount: number
    firstName: string
    lastName: string
  }> {
    const headers = makeHeaders(params.payloadKB * 1024)
    const firstName = headers[0].name
    const lastName = headers[headers.length - 1].name
    const [server, port] = await startServer(headers)
    try {
      const result = await tryClient(
        port,
        firstName,
        lastName,
        params.maxHeaderSize,
      )
      return { result, headerCount: headers.length, firstName, lastName }
    } finally {
      server.close()
    }
  }

  // ── 16K bucket ────────────────────────────────────────────────
  it('A. ~15K payload at default 16K limit fits', async ({ expect }) => {
    const { result, headerCount, firstName, lastName } = await runScenario({
      payloadKB: 15,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 1 server-set Content-Length + all generated X-H-NNNN headers
    expect(result.headerCount).toBe(headerCount + 1)
    expect(result.firstValue.length).toBe(90)
    expect(result.lastValue.length).toBe(90)
    expect(firstName).toBe('X-H-0000')
    expect(lastName).toMatch(/^X-H-\d{4}$/)
  })

  it('B. ~20K payload at default 16K limit overflows (HPE_HEADER_OVERFLOW)', async ({
    expect,
  }) => {
    const { result } = await runScenario({ payloadKB: 20 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('HPE_HEADER_OVERFLOW')
  })

  // ── 32K bucket ────────────────────────────────────────────────
  it('C. ~20K payload raised to 32K limit fits', async ({ expect }) => {
    const { result, headerCount } = await runScenario({
      payloadKB: 20,
      maxHeaderSize: 32 * 1024,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headerCount).toBe(headerCount + 1)
    expect(result.firstValue.length).toBe(90)
    expect(result.lastValue.length).toBe(90)
  })

  it('D. ~40K payload at 32K limit overflows (HPE_HEADER_OVERFLOW)', async ({
    expect,
  }) => {
    const { result } = await runScenario({
      payloadKB: 40,
      maxHeaderSize: 32 * 1024,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('HPE_HEADER_OVERFLOW')
  })

  // ── 64K bucket ────────────────────────────────────────────────
  it('E. ~40K payload raised to 64K limit fits', async ({ expect }) => {
    const { result, headerCount } = await runScenario({
      payloadKB: 40,
      maxHeaderSize: 64 * 1024,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headerCount).toBe(headerCount + 1)
    expect(result.firstValue.length).toBe(90)
    expect(result.lastValue.length).toBe(90)
  })

  it('F. ~60K payload at 64K limit fits', async ({ expect }) => {
    const { result, headerCount } = await runScenario({
      payloadKB: 60,
      maxHeaderSize: 64 * 1024,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.headerCount).toBe(headerCount + 1)
    expect(result.firstValue.length).toBe(90)
    expect(result.lastValue.length).toBe(90)
  })
})
