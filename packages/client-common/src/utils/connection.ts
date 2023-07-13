import type { ClickHouseSettings } from '../settings'
import * as uuid from 'uuid'

export type HttpHeader = number | string | string[]
export type HttpHeaders = Record<string, HttpHeader | undefined>

export function withCompressionHeaders({
  headers,
  compress_request,
  decompress_response,
}: {
  headers: HttpHeaders
  compress_request: boolean | undefined
  decompress_response: boolean | undefined
}): Record<string, string> {
  return {
    ...headers,
    ...(decompress_response ? { 'Accept-Encoding': 'gzip' } : {}),
    ...(compress_request ? { 'Content-Encoding': 'gzip' } : {}),
  }
}

export function withHttpSettings(
  clickhouse_settings?: ClickHouseSettings,
  compression?: boolean
): ClickHouseSettings {
  return {
    ...(compression
      ? {
          enable_http_compression: 1,
        }
      : {}),
    ...clickhouse_settings,
  }
}

export function isSuccessfulResponse(statusCode?: number): boolean {
  return Boolean(statusCode && 200 <= statusCode && statusCode < 300)
}

export function getQueryId(query_id: string | undefined): string {
  return query_id || uuid.v4()
}
