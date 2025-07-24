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

type ToSearchParamsOptions = {
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
  const params = new URLSearchParams()
  params.set('query_id', query_id)

  if (query_params !== undefined) {
    for (const [key, value] of Object.entries(query_params)) {
      const formattedParam = formatQueryParams({ value })
      params.set(`param_${key}`, formattedParam)
    }
  }

  if (clickhouse_settings !== undefined) {
    for (const [key, value] of Object.entries(clickhouse_settings)) {
      if (value !== undefined) {
        params.set(key, formatQuerySettings(value))
      }
    }
  }

  if (database !== undefined && database !== 'default') {
    params.set('database', database)
  }

  if (query) {
    params.set('query', query)
  }

  if (session_id) {
    params.set('session_id', session_id)
  }

  if (role) {
    if (typeof role === 'string') {
      params.set('role', role)
    } else if (Array.isArray(role)) {
      for (const r of role) {
        params.append('role', r)
      }
    }
  }

  return params
}
