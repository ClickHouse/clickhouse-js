import { Runtime } from './runtime'

/**
 * Generate a user agent string like
 * ```
 * clickhouse-js/0.0.11 (lv:nodejs/19.0.4; os:linux)
 * ```
 * or
 * ```
 * MyApplicationName clickhouse-js/0.0.11 (lv:nodejs/19.0.4; os:linux)
 * ```
 */
export function getUserAgent(application_id?: string): string {
  const defaultUserAgent = `clickhouse-js/${Runtime.package} (lv:nodejs/${
    Runtime.node
  }; os:${Runtime.os})`
  return application_id
    ? `${application_id} ${defaultUserAgent}`
    : defaultUserAgent
}
