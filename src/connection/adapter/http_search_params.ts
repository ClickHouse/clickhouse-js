import { formatQueryParams, formatQuerySettings } from '../../data_formatter/'
import type { ClickHouseSettings } from '../../settings'

type ToSearchParamsOptions = {
  database: string
  clickhouse_settings?: ClickHouseSettings
  query_params?: Record<string, unknown>
  query?: string
  session_id?: string
}

// TODO validate max length of the resulting query
// https://stackoverflow.com/questions/812925/what-is-the-maximum-possible-length-of-a-query-string
export function toSearchParams({
  database,
  query,
  query_params,
  clickhouse_settings,
  session_id,
}: ToSearchParamsOptions): URLSearchParams | undefined {
  if (
    clickhouse_settings === undefined &&
    query_params === undefined &&
    query === undefined &&
    database === 'default'
  ) {
    return
  }

  const params = new URLSearchParams()

  if (query_params !== undefined) {
    for (const [key, value] of Object.entries(query_params)) {
      params.set(`param_${key}`, formatQueryParams(value))
    }
  }

  if (clickhouse_settings !== undefined) {
    for (const [key, value] of Object.entries(clickhouse_settings)) {
      if (value !== undefined) {
        params.set(key, formatQuerySettings(value))
      }
    }
  }

  if (database !== 'default') {
    params.set('database', database)
  }

  if (query) {
    params.set('query', query)
  }

  if (session_id) {
    params.set('session_id', session_id)
  }

  return params
}
