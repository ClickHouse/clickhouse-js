# ClickHouse JS client examples

Examples are grouped by client flavor:

- [`examples/node`](node) — examples for the Node.js client (`@clickhouse/client`).
- [`examples/web`](web) — examples for the Web client (`@clickhouse/client-web`).

Most general-purpose examples (configuration, ping, inserts, selects, parameters, sessions, etc.) exist
in both subdirectories with the only difference being the `import` statement and a few platform-specific
adjustments (e.g. `globalThis.crypto.randomUUID()` for the Web client vs Node's `crypto` module).

Examples that rely on Node.js-only APIs (file streams, TLS, `http`, Node `EventEmitter`, etc.) live only
under `examples/node`.

## Overview

We aim to cover various scenarios of client usage with these examples. You should be able to run any of
these examples — see [How to run](#how-to-run) below.

If something is missing, or you found a mistake in one of these examples, please open an issue or a pull
request, or [contact us](../README.md#contact-us).

#### General usage

| Example                                                      | Node                                                                                           | Web                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Client configuration via URL parameters                      | [node/url_configuration.ts](node/url_configuration.ts)                                         | [web/url_configuration.ts](web/url_configuration.ts)                                         |
| ClickHouse settings (global and per-request)                 | [node/clickhouse_settings.ts](node/clickhouse_settings.ts)                                     | [web/clickhouse_settings.ts](web/clickhouse_settings.ts)                                     |
| Successful ping against an existing host                     | [node/ping_existing_host.ts](node/ping_existing_host.ts)                                       | [web/ping_existing_host.ts](web/ping_existing_host.ts)                                       |
| Ping against a host that does not exist                      | [node/ping_non_existing_host.ts](node/ping_non_existing_host.ts)                               | [web/ping_non_existing_host.ts](web/ping_non_existing_host.ts)                               |
| Ping that times out (Node.js only)                           | [node/ping_timeout.ts](node/ping_timeout.ts)                                                   | —                                                                                            |
| Cancelling an outgoing request                               | [node/abort_request.ts](node/abort_request.ts)                                                 | [web/abort_request.ts](web/abort_request.ts)                                                 |
| Cancelling a query on the server                             | [node/cancel_query.ts](node/cancel_query.ts)                                                   | [web/cancel_query.ts](web/cancel_query.ts)                                                   |
| Long-running queries via progress headers                    | [node/long_running_queries_progress_headers.ts](node/long_running_queries_progress_headers.ts) | [web/long_running_queries_progress_headers.ts](web/long_running_queries_progress_headers.ts) |
| Long-running queries via request cancellation (Node.js only) | [node/long_running_queries_cancel_request.ts](node/long_running_queries_cancel_request.ts)     | —                                                                                            |
| Read-only user limitations                                   | [node/read_only_user.ts](node/read_only_user.ts)                                               | [web/read_only_user.ts](web/read_only_user.ts)                                               |
| Basic TLS authentication (Node.js only)                      | [node/basic_tls.ts](node/basic_tls.ts)                                                         | —                                                                                            |
| Mutual TLS authentication (Node.js only)                     | [node/mutual_tls.ts](node/mutual_tls.ts)                                                       | —                                                                                            |
| Custom JSON `parse`/`stringify`                              | [node/custom_json_handling.ts](node/custom_json_handling.ts)                                   | [web/custom_json_handling.ts](web/custom_json_handling.ts)                                   |

#### Creating tables

| Example                | Node                                                                               | Web                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Single-node deployment | [node/create_table_single_node.ts](node/create_table_single_node.ts)               | [web/create_table_single_node.ts](web/create_table_single_node.ts)               |
| On-premise cluster     | [node/create_table_on_premise_cluster.ts](node/create_table_on_premise_cluster.ts) | [web/create_table_on_premise_cluster.ts](web/create_table_on_premise_cluster.ts) |
| ClickHouse Cloud       | [node/create_table_cloud.ts](node/create_table_cloud.ts)                           | [web/create_table_cloud.ts](web/create_table_cloud.ts)                           |

#### Inserting data

| Example                                                    | Node                                                                                         | Web                                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Array of values via `JSONEachRow`                          | [node/array_json_each_row.ts](node/array_json_each_row.ts)                                   | [web/array_json_each_row.ts](web/array_json_each_row.ts)                   |
| Overview of insert data formats                            | [node/insert_data_formats_overview.ts](node/insert_data_formats_overview.ts)                 | [web/insert_data_formats_overview.ts](web/insert_data_formats_overview.ts) |
| Async inserts (waiting for ack)                            | [node/async_insert.ts](node/async_insert.ts)                                                 | [web/async_insert.ts](web/async_insert.ts)                                 |
| Async inserts without waiting (Node.js only)               | [node/async_insert_without_waiting.ts](node/async_insert_without_waiting.ts)                 | —                                                                          |
| Insert into a specific subset of columns                   | [node/insert_specific_columns.ts](node/insert_specific_columns.ts)                           | [web/insert_specific_columns.ts](web/insert_specific_columns.ts)           |
| Insert excluding columns                                   | [node/insert_exclude_columns.ts](node/insert_exclude_columns.ts)                             | [web/insert_exclude_columns.ts](web/insert_exclude_columns.ts)             |
| `INSERT FROM SELECT`                                       | [node/insert_from_select.ts](node/insert_from_select.ts)                                     | [web/insert_from_select.ts](web/insert_from_select.ts)                     |
| Insert into a different database                           | [node/insert_into_different_db.ts](node/insert_into_different_db.ts)                         | [web/insert_into_different_db.ts](web/insert_into_different_db.ts)         |
| Insert decimals                                            | [node/insert_decimals.ts](node/insert_decimals.ts)                                           | [web/insert_decimals.ts](web/insert_decimals.ts)                           |
| Insert JS `Date` objects                                   | [node/insert_js_dates.ts](node/insert_js_dates.ts)                                           | [web/insert_js_dates.ts](web/insert_js_dates.ts)                           |
| Stream a CSV file (Node.js only)                           | [node/insert_file_stream_csv.ts](node/insert_file_stream_csv.ts)                             | —                                                                          |
| Stream an NDJSON file (Node.js only)                       | [node/insert_file_stream_ndjson.ts](node/insert_file_stream_ndjson.ts)                       | —                                                                          |
| Stream a Parquet file (Node.js only)                       | [node/insert_file_stream_parquet.ts](node/insert_file_stream_parquet.ts)                     | —                                                                          |
| Insert in arbitrary format via stream (Node.js only)       | [node/insert_arbitrary_format_stream.ts](node/insert_arbitrary_format_stream.ts)             | —                                                                          |
| Convert string input into a stream (Node.js only)          | [node/stream_created_from_array_raw.ts](node/stream_created_from_array_raw.ts)               | —                                                                          |
| Streaming insert with backpressure handling (Node.js only) | [node/insert_streaming_with_backpressure.ts](node/insert_streaming_with_backpressure.ts)     | —                                                                          |
| Simple streaming insert with backpressure (Node.js only)   | [node/insert_streaming_backpressure_simple.ts](node/insert_streaming_backpressure_simple.ts) | —                                                                          |
| `INSERT INTO ... VALUES` with functions                    | [node/insert_values_and_functions.ts](node/insert_values_and_functions.ts)                   | [web/insert_values_and_functions.ts](web/insert_values_and_functions.ts)   |
| Insert into a table with ephemeral columns                 | [node/insert_ephemeral_columns.ts](node/insert_ephemeral_columns.ts)                         | [web/insert_ephemeral_columns.ts](web/insert_ephemeral_columns.ts)         |

#### Selecting data

| Example                                               | Node                                                                                                     | Web                                                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Simple select in `JSONEachRow`                        | [node/select_json_each_row.ts](node/select_json_each_row.ts)                                             | [web/select_json_each_row.ts](web/select_json_each_row.ts)                                             |
| Overview of select data formats                       | [node/select_data_formats_overview.ts](node/select_data_formats_overview.ts)                             | [web/select_data_formats_overview.ts](web/select_data_formats_overview.ts)                             |
| Select with metadata (`JSON` format)                  | [node/select_json_with_metadata.ts](node/select_json_with_metadata.ts)                                   | [web/select_json_with_metadata.ts](web/select_json_with_metadata.ts)                                   |
| Query parameter binding                               | [node/query_with_parameter_binding.ts](node/query_with_parameter_binding.ts)                             | [web/query_with_parameter_binding.ts](web/query_with_parameter_binding.ts)                             |
| Query parameter binding with special chars            | [node/query_with_parameter_binding_special_chars.ts](node/query_with_parameter_binding_special_chars.ts) | [web/query_with_parameter_binding_special_chars.ts](web/query_with_parameter_binding_special_chars.ts) |
| Save a select result as a Parquet file (Node.js only) | [node/select_parquet_as_file.ts](node/select_parquet_as_file.ts)                                         | —                                                                                                      |
| Stream `JSONEachRow` via `on('data')` (Node.js only)  | [node/select_streaming_json_each_row.ts](node/select_streaming_json_each_row.ts)                         | —                                                                                                      |
| Stream `JSONEachRow` via `for await` (Node.js only)   | [node/select_streaming_json_each_row_for_await.ts](node/select_streaming_json_each_row_for_await.ts)     | —                                                                                                      |
| Stream text formats line by line (Node.js only)       | [node/select_streaming_text_line_by_line.ts](node/select_streaming_text_line_by_line.ts)                 | —                                                                                                      |
| `JSONEachRowWithProgress` streaming (Node.js only)    | [node/select_json_each_row_with_progress.ts](node/select_json_each_row_with_progress.ts)                 | —                                                                                                      |

#### Data types

| Example                              | Node                                                         | Web                                                        |
| ------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------- |
| Dynamic / Variant / JSON             | [node/dynamic_variant_json.ts](node/dynamic_variant_json.ts) | [web/dynamic_variant_json.ts](web/dynamic_variant_json.ts) |
| `Time` / `Time64` (ClickHouse 25.6+) | [node/time_time64.ts](node/time_time64.ts)                   | [web/time_time64.ts](web/time_time64.ts)                   |

#### Special cases

| Example                                          | Node                                                                               | Web                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Default format setting (`exec` without `FORMAT`) | [node/default_format_setting.ts](node/default_format_setting.ts)                   | [web/default_format_setting.ts](web/default_format_setting.ts)                   |
| Temporary tables with `session_id`               | [node/session_id_and_temporary_tables.ts](node/session_id_and_temporary_tables.ts) | [web/session_id_and_temporary_tables.ts](web/session_id_and_temporary_tables.ts) |
| `SET` commands per `session_id`                  | [node/session_level_commands.ts](node/session_level_commands.ts)                   | [web/session_level_commands.ts](web/session_level_commands.ts)                   |
| Using one or more roles                          | [node/role.ts](node/role.ts)                                                       | [web/role.ts](web/role.ts)                                                       |

## How to run

### Prerequisites

Environment requirements for all examples:

- Node.js 18+
- NPM
- Docker Compose

Run ClickHouse in Docker from the root folder of this repository:

```bash
docker-compose up -d
```

This will create two local ClickHouse instances: one with plain authentication and one that requires
[TLS](#tls-examples).

### Any example except `create_table_*`

Each subdirectory (`node` and `web`) is now an independent npm package with its own
`package.json`, `tsconfig.json`, and `eslint.config.mjs`. Install dependencies in the
subdirectory matching the example you want to run:

```sh
# For Node.js examples
cd examples/node
npm i

# For Web examples
cd examples/web
npm i
```

Then, you should be able to run the sample programs, for example:

```sh
# from examples/node
npx tsx --transpile-only array_json_each_row.ts

# from examples/web
npx tsx --transpile-only array_json_each_row.ts
```

### TLS examples

You will need to add `server.clickhouseconnect.test` to your `/etc/hosts` to make it work, as
self-signed certificates are used in these examples.

Execute the following command to add the required `/etc/hosts` entry:

```bash
sudo -- sh -c "echo 127.0.0.1 server.clickhouseconnect.test >> /etc/hosts"
```

After that, you should be able to run the examples (from `examples/node`):

```bash
npx tsx --transpile-only basic_tls.ts
npx tsx --transpile-only mutual_tls.ts
npx tsx --transpile-only create_table_on_premise_cluster.ts
```

### ClickHouse Cloud examples

- for `*_cloud.ts` examples, Docker containers are not required, but you need to set some environment
  variables first for the Node.js client:

```sh
export CLICKHOUSE_CLOUD_URL=https://<your-clickhouse-cloud-hostname>:8443
export CLICKHOUSE_CLOUD_PASSWORD=<your-clickhouse-cloud-password>
```

and for the Web client, you need to set these variables in the examples themselves.

You can obtain these credentials in the ClickHouse Cloud console (check
[the docs](https://clickhouse.com/docs/en/integrations/language-clients/javascript#gather-your-connection-details)
for more information).

Cloud examples assume that you are using the `default` user and database.

Run one of the Cloud examples (from `examples/node`):

```
npx tsx --transpile-only create_table_cloud.ts
```

### Environment variables for runnable examples

The following environment variables control behavior when running examples in automated environments (e.g., CI):

- `EXAMPLE_LONG_QUERY_MAX_POLLS` — Caps the polling loop in `long_running_queries_cancel_request.ts`. Default: `400` (production-like timeout). CI sets this to `60` to keep test suite runtime under 60 seconds.

- `CLICKHOUSE_TLS_URL` — Overrides the URL for TLS examples (`basic_tls.ts`, `mutual_tls.ts`). Default: `https://server.clickhouseconnect.test:8443`.

- `CLICKHOUSE_CLUSTER_URL` — Overrides the URL for on-premise cluster examples. Default: `http://localhost:8127`.

- `CLICKHOUSE_CLOUD_URL` / `CLICKHOUSE_CLOUD_PASSWORD` — When set, the Cloud examples (`*_cloud.ts`) will connect to the specified ClickHouse Cloud instance. When unset, these examples skip with an informative log message.
