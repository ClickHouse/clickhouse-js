import packageVersion from '@clickhouse/client-common/version'

// FIXME
export function getUserAgent(application_id?: string): string {
  const defaultUserAgent = `clickhouse-js/${packageVersion} (lv:browser/0.0.0; os:unknown})`
  return application_id
    ? `${application_id} ${defaultUserAgent}`
    : defaultUserAgent
}
