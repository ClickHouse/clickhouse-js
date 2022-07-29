import { type ClickHouseSettings } from '../../clickhouse_types';
import { formatQueryParams, formatQuerySettings } from '../../data_formatter/';

// TODO validate max length of the resulting query
// https://stackoverflow.com/questions/812925/what-is-the-maximum-possible-length-of-a-query-string
export function toSearchParams(
  settings?: ClickHouseSettings,
  query_params?: Record<string, unknown>,
  query?: string
): URLSearchParams | undefined {
  if (
    settings === undefined &&
    query_params === undefined &&
    query === undefined
  )
    return;
  const params = new URLSearchParams();
  if (query_params !== undefined) {
    for (const [key, value] of Object.entries(query_params)) {
      params.set(`param_${key}`, formatQueryParams(value));
    }
  }
  if (settings !== undefined) {
    for (const [key, value] of Object.entries(settings)) {
      params.set(key, formatQuerySettings(value));
    }
  }

  if (query) {
    params.set('query', query);
  }
  return params;
}
