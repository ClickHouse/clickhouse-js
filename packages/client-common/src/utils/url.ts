import { formatQueryParams, formatQuerySettings } from "../data_formatter";
import type { PreparedExternalData } from "../external_data";
import type { ClickHouseSettings } from "../settings";

export function transformUrl({
  url,
  pathname,
  searchParams,
}: {
  url: URL;
  pathname?: string;
  searchParams?: URLSearchParams;
}): URL {
  const newUrl = new URL(url);

  if (pathname) {
    // See https://developer.mozilla.org/en-US/docs/Web/API/URL/pathname
    // > value for such "special scheme" URLs can never be the empty string,
    // > but will instead always have at least one / character.
    if (newUrl.pathname === "/") {
      newUrl.pathname = pathname;
    } else {
      newUrl.pathname += pathname;
    }
  }

  if (searchParams) {
    newUrl.search = searchParams?.toString();
  }

  return newUrl;
}

interface ToSearchParamsOptions {
  database: string | undefined;
  clickhouse_settings?: ClickHouseSettings;
  query_params?: Record<string, unknown>;
  /** Pre-serialized `param_*` entries (e.g. from {@link serializeQueryParamsForUrl});
   *  used as-is instead of serializing {@link query_params} again. */
  param_entries?: [string, string][];
  external_data?: ReadonlyArray<PreparedExternalData<unknown>>;
  query?: string;
  session_id?: string;
  query_id: string;
  role?: string | Array<string>;
}

export function toSearchParams({
  database,
  query,
  query_params,
  param_entries,
  external_data,
  clickhouse_settings,
  session_id,
  query_id,
  role,
}: ToSearchParamsOptions): URLSearchParams {
  let entries: [string, string][];
  if (param_entries) {
    entries = param_entries;
    entries.push(["query_id", query_id]);
  } else {
    entries = [["query_id", query_id]];
    if (query_params !== undefined) {
      for (const [key, value] of Object.entries(query_params)) {
        const formattedParam = formatQueryParams({ value });
        entries.push([`param_${key}`, formattedParam]);
      }
    }
  }

  const externalDataEntries: [string, string][] = [];
  if (external_data !== undefined) {
    for (const ext of external_data) {
      if (ext.structure !== undefined) {
        externalDataEntries.push([`${ext.name}_structure`, ext.structure]);
      } else if (ext.types !== undefined) {
        externalDataEntries.push([`${ext.name}_types`, ext.types]);
      }
      if (ext.format !== undefined) {
        externalDataEntries.push([`${ext.name}_format`, ext.format]);
      }
    }
  }

  if (clickhouse_settings !== undefined) {
    for (const [key, value] of Object.entries(clickhouse_settings)) {
      if (value !== undefined) {
        entries.push([key, formatQuerySettings(value)]);
      }
    }
  }

  if (database !== undefined && database !== "default") {
    entries.push(["database", database]);
  }

  if (query) {
    entries.push(["query", query]);
  }

  if (session_id) {
    entries.push(["session_id", session_id]);
  }

  if (role) {
    if (typeof role === "string") {
      entries.push(["role", role]);
    } else if (Array.isArray(role)) {
      for (const r of role) {
        entries.push(["role", r]);
      }
    }
  }

  rejectExternalDataKeyCollisions(externalDataEntries, entries);
  entries.push(...externalDataEntries);
  return new URLSearchParams(entries);
}

// The server reads `<name>_format` and the other external table keys from the
// same URL query string as the settings. A table named `default` with a format
// gives a second `default_format` key, and the server then parses the table
// with the result format of the query.
function rejectExternalDataKeyCollisions(
  externalDataEntries: [string, string][],
  otherEntries: [string, string][],
): void {
  if (externalDataEntries.length === 0) {
    return;
  }
  const otherKeys = new Set(otherEntries.map(([key]) => key));
  for (const [key] of externalDataEntries) {
    if (otherKeys.has(key)) {
      throw new Error(
        `Invalid external_data name: the URL parameter "${key}" of an external table ` +
          `is the same as a setting or a parameter of the request. Use a different table name.`,
      );
    }
  }
}
