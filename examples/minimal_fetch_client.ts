/**
 * Minimal ClickHouse client implementation using the Fetch API
 *
 * This is a simplified implementation that demonstrates core functionality
 * without the full complexity of the official client library. Some API
 * differences from the official client are acceptable for this example.
 */

interface ClientConfig {
  url?: string
  username?: string
  password?: string
  database?: string
  request_timeout?: number
}

interface QueryParams {
  query: string
  format?: string
  clickhouse_settings?: Record<string, string | number>
  query_params?: Record<string, string | number>
}

interface InsertParams<T = unknown> {
  table: string
  values: T[]
  format?: string
  clickhouse_settings?: Record<string, string | number>
}

interface CommandParams {
  query: string
  clickhouse_settings?: Record<string, string | number>
}

class MinimalClickHouseClient {
  private url: string
  private authHeader: string
  private database: string
  private request_timeout: number

  constructor(config: ClientConfig = {}) {
    this.url =
      config.url || process.env.CLICKHOUSE_URL || 'http://localhost:8123'
    this.database = config.database || 'default'
    this.request_timeout = config.request_timeout || 30000

    const username = config.username || 'default'
    const password = config.password || process.env.CLICKHOUSE_PASSWORD || ''
    this.authHeader = `Basic ${btoa(`${username}:${password}`)}`
  }

  async query<T = unknown>(params: QueryParams): Promise<T[]> {
    const format = params.format || 'JSONEachRow'
    const queryWithFormat = params.query.trim().match(/FORMAT\s+\w+$/i)
      ? params.query
      : `${params.query} FORMAT ${format}`

    const searchParams = new URLSearchParams()
    searchParams.set('database', this.database)

    if (params.clickhouse_settings) {
      for (const [key, value] of Object.entries(params.clickhouse_settings)) {
        searchParams.set(key, String(value))
      }
    }

    if (params.query_params) {
      for (const [key, value] of Object.entries(params.query_params)) {
        searchParams.set(`param_${key}`, String(value))
      }
    }

    const url = `${this.url}/?${searchParams.toString()}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.request_timeout)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
        },
        body: queryWithFormat,
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`ClickHouse query failed: ${errorText}`)
      }

      const text = await response.text()

      // Handle different formats
      if (format === 'JSONEachRow') {
        return text
          .trim()
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line))
      } else if (format === 'JSON') {
        const parsed = JSON.parse(text)
        return parsed.data || []
      } else {
        // For other formats, return raw text wrapped in an object
        return [{ result: text }] as any
      }
    } catch (error) {
      clearTimeout(timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Timeout error.')
      }
      throw error
    }
  }

  async insert<T = unknown>(params: InsertParams<T>): Promise<void> {
    const format = params.format || 'JSONEachRow'
    const query = `INSERT INTO ${params.table} FORMAT ${format}`

    const searchParams = new URLSearchParams()
    searchParams.set('database', this.database)
    searchParams.set('query', query)

    if (params.clickhouse_settings) {
      for (const [key, value] of Object.entries(params.clickhouse_settings)) {
        searchParams.set(key, String(value))
      }
    }

    let body: string
    if (format === 'JSONEachRow') {
      body = params.values.map((row) => JSON.stringify(row)).join('\n')
    } else {
      // For other formats, assume values is already formatted
      body = JSON.stringify(params.values)
    }

    const url = `${this.url}/?${searchParams.toString()}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.request_timeout)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
        },
        body,
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`ClickHouse insert failed: ${errorText}`)
      }

      // Drain the response
      await response.text()
    } catch (error) {
      clearTimeout(timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Timeout error.')
      }
      throw error
    }
  }

  async command(params: CommandParams): Promise<void> {
    const searchParams = new URLSearchParams()
    searchParams.set('database', this.database)

    if (params.clickhouse_settings) {
      for (const [key, value] of Object.entries(params.clickhouse_settings)) {
        searchParams.set(key, String(value))
      }
    }

    const url = `${this.url}/?${searchParams.toString()}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.request_timeout)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
        },
        body: params.query,
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`ClickHouse command failed: ${errorText}`)
      }

      // Drain the response
      await response.text()
    } catch (error) {
      clearTimeout(timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Timeout error.')
      }
      throw error
    }
  }

  async ping(): Promise<{ success: boolean; error?: Error }> {
    try {
      const searchParams = new URLSearchParams()
      searchParams.set('query', `SELECT 'ping'`)

      const url = `${this.url}/?${searchParams.toString()}`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.request_timeout)

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
        },
        signal: controller.signal,
      })

      clearTimeout(timeout)
      await response.text() // Drain response

      return { success: true }
    } catch (error) {
      if (error instanceof Error) {
        return { success: false, error }
      }
      throw error
    }
  }

  async close(): Promise<void> {
    // No-op for fetch-based client
    return
  }
}

// Factory function similar to official client
export function createClient(config?: ClientConfig): MinimalClickHouseClient {
  return new MinimalClickHouseClient(config)
}

// Export for direct instantiation if needed
export { MinimalClickHouseClient }
