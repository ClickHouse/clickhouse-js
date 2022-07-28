import { type ClickHouseSettings } from '../../clickhouse_types';

// TODO validate max length of the resulting query
// https://stackoverflow.com/questions/812925/what-is-the-maximum-possible-length-of-a-query-string
export function toSearchParams (
  settings?: ClickHouseSettings,
  query_params?: Record<string, unknown>,
  query?: string
): URLSearchParams | undefined {
  if(settings === undefined && query_params === undefined && query === undefined) return;
  const params = new URLSearchParams();
  // TODO validate params - primitives only? array + tuples are supported.
  // https://clickhouse.com/docs/en/interfaces/cli/#cli-queries-with-parameters
  if(query_params !== undefined) {
    for (const [key, value] of Object.entries(query_params)) {
      params.set(`param_${key}`, String(value));
    }
  }
  if(settings !== undefined) {
    for (const [key, value] of Object.entries(settings)) {
      params.set(key, String(value));
    }
  }

  if(query) {
    params.set('query', query);
  }
  return params;
}
