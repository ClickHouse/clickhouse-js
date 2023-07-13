import * as os from 'os'
import packageVersion from '../version'

/**
 * Generate a user agent string like
 * clickhouse-js/0.0.11 (lv:nodejs/19.0.4; os:linux)
 * or
 * MyApplicationName clickhouse-js/0.0.11 (lv:nodejs/19.0.4; os:linux)
 */
export function getUserAgent(application_id?: string): string {
  const defaultUserAgent = `clickhouse-js/${packageVersion} (lv:nodejs/${
    process.version
  }; os:${os.platform()})`
  return application_id
    ? `${application_id} ${defaultUserAgent}`
    : defaultUserAgent
}
