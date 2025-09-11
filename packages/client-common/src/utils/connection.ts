import type { ClickHouseSettings } from '../settings'

export type HttpHeader = number | string | Array<string>
export type HttpHeaders = Record<string, HttpHeader | undefined>

export function withCompressionHeaders({
  headers,
  enable_request_compression,
  enable_response_compression,
}: {
  headers: HttpHeaders
  enable_request_compression: boolean | undefined
  enable_response_compression: boolean | undefined
}): Record<string, string> {
  return {
    ...headers,
    ...(enable_response_compression ? { 'Accept-Encoding': 'gzip' } : {}),
    ...(enable_request_compression ? { 'Content-Encoding': 'gzip' } : {}),
  }
}

export function withHttpSettings(
  clickhouse_settings?: ClickHouseSettings,
  compression?: boolean,
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

export function isJWTAuth(auth: unknown): auth is { access_token: string } {
  return auth !== null && typeof auth === 'object' && 'access_token' in auth
}

export function isCredentialsAuth(
  auth: unknown,
): auth is { username: string; password: string } {
  return (
    auth !== null &&
    typeof auth === 'object' &&
    'username' in auth &&
    'password' in auth
  )
}
