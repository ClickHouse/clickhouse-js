import { formatQueryParams, formatQuerySettings } from '../data_formatter'
import type { ClickHouseSettings } from '../settings'

export function transformUrl({
  url,
  pathname,
  searchParams,
}: {
  url: URL
  pathname?: string
  searchParams?: URLSearchParams
}): URL {
  const newUrl = new URL(url)

  if (pathname) {
    // See https://developer.mozilla.org/en-US/docs/Web/API/URL/pathname
    // > value for such "special scheme" URLs can never be the empty string,
    // > but will instead always have at least one / character.
    if (newUrl.pathname === '/') {
      newUrl.pathname = pathname
    } else {
      newUrl.pathname += pathname
    }
  }

  if (searchParams) {
    newUrl.search = searchParams?.toString()
  }

  return newUrl
}

interface ToSearchParamsOptions {
  database: string | undefined
  clickhouse_settings?: ClickHouseSettings
  query_params?: Record<string, unknown>
  query?: string
  session_id?: string
  query_id: string
  role?: string | Array<string>
}

// TODO validate max length of the resulting query
// https://stackoverflow.com/questions/812925/what-is-the-maximum-possible-length-of-a-query-string
export function toSearchParams({
  database,
  query,
  query_params,
  clickhouse_settings,
  session_id,
  query_id,
  role,
}: ToSearchParamsOptions): URLSearchParams {
  const entries: [string, string][] = [['query_id', query_id]]

  if (query_params !== undefined) {
    for (const [key, value] of Object.entries(query_params)) {
      const formattedParam = formatQueryParams({ value })
      entries.push([`param_${key}`, formattedParam])
    }
  }

  if (clickhouse_settings !== undefined) {
    for (const [key, value] of Object.entries(clickhouse_settings)) {
      if (value !== undefined) {
        entries.push([key, formatQuerySettings(value)])
      }
    }
  }

  if (database !== undefined && database !== 'default') {
    entries.push(['database', database])
  }

  if (query) {
    entries.push(['query', query])
  }

  if (session_id) {
    entries.push(['session_id', session_id])
  }

  if (role) {
    if (typeof role === 'string') {
      entries.push(['role', role])
    } else if (Array.isArray(role)) {
      for (const r of role) {
        entries.push(['role', r])
      }
    }
  }

  return new URLSearchParams(entries)
}
