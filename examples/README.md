# ClickHouse JS client examples

Examples are split first by **client flavor**, then by **use case**:

```
examples/
├── node/                       # @clickhouse/client (Node.js)
│   ├── coding/
│   ├── performance/
│   ├── troubleshooting/
│   ├── security/
│   ├── schema-and-deployments/
│   └── resources/              # shared fixture data
└── web/                        # @clickhouse/client-web
    ├── coding/
    ├── troubleshooting/
    ├── security/
    └── schema-and-deployments/
```

The use-case folders are intent-driven ("what is the agent or user trying to do?")
so each folder is a tight, self-contained corpus that can back a focused AI agent
skill. A few examples appear in more than one folder **on purpose** — duplication
keeps each skill self-contained instead of forcing cross-folder references. When
running examples, every duplicated file has one _primary_ location and the
secondary copies are excluded from the Vitest runner (see
[`examples/node/vitest.config.ts`](node/vitest.config.ts) and
[`examples/web/vitest.config.ts`](web/vitest.config.ts)). When you edit a
duplicated example, update **all** copies.

`examples/web` does not have a `performance/` folder because every performance
example depends on Node-only APIs (Node streams, `node:fs`, Parquet file I/O).

Most general-purpose examples (configuration, ping, inserts, selects, parameters,
sessions, etc.) exist in both `node/` and `web/`. The only differences are the
`import` statement and a few platform-specific adjustments (e.g.
`globalThis.crypto.randomUUID()` for the Web client vs Node's `crypto` module).

If something is missing, or you found a mistake in one of these examples, please
open an issue or a pull request, or [contact us](../README.md#contact-us).

## Categories

### `coding/` — Day-to-day client API usage

"How do I do X with the client?" — connect, configure, ping, basic insert/select,
parameter binding, sessions, data types, and custom JSON handling.

| Example                                        | Node                                                                                                                   | Web                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Client configuration via URL parameters        | [node/coding/url_configuration.ts](node/coding/url_configuration.ts)                                                   | [web/coding/url_configuration.ts](web/coding/url_configuration.ts)                                                   |
| ClickHouse settings (global and per-request)   | [node/coding/clickhouse_settings.ts](node/coding/clickhouse_settings.ts)                                               | [web/coding/clickhouse_settings.ts](web/coding/clickhouse_settings.ts)                                               |
| Default format setting (`exec` without FORMAT) | [node/coding/default_format_setting.ts](node/coding/default_format_setting.ts)                                         | [web/coding/default_format_setting.ts](web/coding/default_format_setting.ts)                                         |
| Successful ping against an existing host       | [node/coding/ping_existing_host.ts](node/coding/ping_existing_host.ts)                                                 | [web/coding/ping_existing_host.ts](web/coding/ping_existing_host.ts)                                                 |
| Ping against a host that does not exist        | [node/coding/ping_non_existing_host.ts](node/coding/ping_non_existing_host.ts)                                         | [web/coding/ping_non_existing_host.ts](web/coding/ping_non_existing_host.ts)                                         |
| Array of values via `JSONEachRow`              | [node/coding/array_json_each_row.ts](node/coding/array_json_each_row.ts)                                               | [web/coding/array_json_each_row.ts](web/coding/array_json_each_row.ts)                                               |
| Overview of insert data formats                | [node/coding/insert_data_formats_overview.ts](node/coding/insert_data_formats_overview.ts)                             | [web/coding/insert_data_formats_overview.ts](web/coding/insert_data_formats_overview.ts)                             |
| Insert into a specific subset of columns       | [node/coding/insert_specific_columns.ts](node/coding/insert_specific_columns.ts)                                       | [web/coding/insert_specific_columns.ts](web/coding/insert_specific_columns.ts)                                       |
| Insert excluding columns                       | [node/coding/insert_exclude_columns.ts](node/coding/insert_exclude_columns.ts)                                         | [web/coding/insert_exclude_columns.ts](web/coding/insert_exclude_columns.ts)                                         |
| Insert into a table with ephemeral columns     | [node/coding/insert_ephemeral_columns.ts](node/coding/insert_ephemeral_columns.ts)                                     | [web/coding/insert_ephemeral_columns.ts](web/coding/insert_ephemeral_columns.ts)                                     |
| Insert into a different database               | [node/coding/insert_into_different_db.ts](node/coding/insert_into_different_db.ts)                                     | [web/coding/insert_into_different_db.ts](web/coding/insert_into_different_db.ts)                                     |
| `INSERT FROM SELECT`                           | [node/coding/insert_from_select.ts](node/coding/insert_from_select.ts)                                                 | [web/coding/insert_from_select.ts](web/coding/insert_from_select.ts)                                                 |
| `INSERT INTO ... VALUES` with functions        | [node/coding/insert_values_and_functions.ts](node/coding/insert_values_and_functions.ts)                               | [web/coding/insert_values_and_functions.ts](web/coding/insert_values_and_functions.ts)                               |
| Insert JS `Date` objects                       | [node/coding/insert_js_dates.ts](node/coding/insert_js_dates.ts)                                                       | [web/coding/insert_js_dates.ts](web/coding/insert_js_dates.ts)                                                       |
| Insert decimals                                | [node/coding/insert_decimals.ts](node/coding/insert_decimals.ts)                                                       | [web/coding/insert_decimals.ts](web/coding/insert_decimals.ts)                                                       |
| Async inserts (waiting for ack)                | [node/coding/async_insert.ts](node/coding/async_insert.ts)                                                             | [web/coding/async_insert.ts](web/coding/async_insert.ts)                                                             |
| Simple select in `JSONEachRow`                 | [node/coding/select_json_each_row.ts](node/coding/select_json_each_row.ts)                                             | [web/coding/select_json_each_row.ts](web/coding/select_json_each_row.ts)                                             |
| Overview of select data formats                | [node/coding/select_data_formats_overview.ts](node/coding/select_data_formats_overview.ts)                             | [web/coding/select_data_formats_overview.ts](web/coding/select_data_formats_overview.ts)                             |
| Select with metadata (`JSON` format)           | [node/coding/select_json_with_metadata.ts](node/coding/select_json_with_metadata.ts)                                   | [web/coding/select_json_with_metadata.ts](web/coding/select_json_with_metadata.ts)                                   |
| Query parameter binding                        | [node/coding/query_with_parameter_binding.ts](node/coding/query_with_parameter_binding.ts)                             | [web/coding/query_with_parameter_binding.ts](web/coding/query_with_parameter_binding.ts)                             |
| Query parameter binding with special chars     | [node/coding/query_with_parameter_binding_special_chars.ts](node/coding/query_with_parameter_binding_special_chars.ts) | [web/coding/query_with_parameter_binding_special_chars.ts](web/coding/query_with_parameter_binding_special_chars.ts) |
| Temporary tables with `session_id`             | [node/coding/session_id_and_temporary_tables.ts](node/coding/session_id_and_temporary_tables.ts)                       | [web/coding/session_id_and_temporary_tables.ts](web/coding/session_id_and_temporary_tables.ts)                       |
| `SET` commands per `session_id`                | [node/coding/session_level_commands.ts](node/coding/session_level_commands.ts)                                         | [web/coding/session_level_commands.ts](web/coding/session_level_commands.ts)                                         |
| Dynamic / Variant / JSON                       | [node/coding/dynamic_variant_json.ts](node/coding/dynamic_variant_json.ts)                                             | [web/coding/dynamic_variant_json.ts](web/coding/dynamic_variant_json.ts)                                             |
| `Time` / `Time64` (ClickHouse 25.6+)           | [node/coding/time_time64.ts](node/coding/time_time64.ts)                                                               | [web/coding/time_time64.ts](web/coding/time_time64.ts)                                                               |
| Custom JSON `parse`/`stringify`                | [node/coding/custom_json_handling.ts](node/coding/custom_json_handling.ts)                                             | [web/coding/custom_json_handling.ts](web/coding/custom_json_handling.ts)                                             |

### `performance/` — Streaming, batching, and high-throughput patterns

"How do I make ingestion or queries fast and scalable?" — async inserts without
waiting, streaming inserts and selects with backpressure, file-stream ingestion,
progress streaming, and server-side bulk moves. All performance examples are
Node-only because they depend on Node streams, `node:fs`, or Parquet file I/O.

| Example                                      | Node                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Async inserts (waiting for ack)              | [node/performance/async_insert.ts](node/performance/async_insert.ts)                                                         |
| Async inserts without waiting                | [node/performance/async_insert_without_waiting.ts](node/performance/async_insert_without_waiting.ts)                         |
| Streaming insert with backpressure handling  | [node/performance/insert_streaming_with_backpressure.ts](node/performance/insert_streaming_with_backpressure.ts)             |
| Simple streaming insert with backpressure    | [node/performance/insert_streaming_backpressure_simple.ts](node/performance/insert_streaming_backpressure_simple.ts)         |
| Insert in arbitrary format via stream        | [node/performance/insert_arbitrary_format_stream.ts](node/performance/insert_arbitrary_format_stream.ts)                     |
| Convert string input into a stream           | [node/performance/stream_created_from_array_raw.ts](node/performance/stream_created_from_array_raw.ts)                       |
| Stream a CSV file                            | [node/performance/insert_file_stream_csv.ts](node/performance/insert_file_stream_csv.ts)                                     |
| Stream an NDJSON file                        | [node/performance/insert_file_stream_ndjson.ts](node/performance/insert_file_stream_ndjson.ts)                               |
| Stream a Parquet file                        | [node/performance/insert_file_stream_parquet.ts](node/performance/insert_file_stream_parquet.ts)                             |
| Stream `JSONEachRow` via `on('data')`        | [node/performance/select_streaming_json_each_row.ts](node/performance/select_streaming_json_each_row.ts)                     |
| Stream `JSONEachRow` via `for await`         | [node/performance/select_streaming_json_each_row_for_await.ts](node/performance/select_streaming_json_each_row_for_await.ts) |
| Stream text formats line by line             | [node/performance/select_streaming_text_line_by_line.ts](node/performance/select_streaming_text_line_by_line.ts)             |
| Save a select result as a Parquet file       | [node/performance/select_parquet_as_file.ts](node/performance/select_parquet_as_file.ts)                                     |
| `JSONEachRowWithProgress` streaming          | [node/performance/select_json_each_row_with_progress.ts](node/performance/select_json_each_row_with_progress.ts)             |
| `INSERT FROM SELECT` (server-side bulk move) | [node/performance/insert_from_select.ts](node/performance/insert_from_select.ts)                                             |

### `troubleshooting/` — Diagnose, recover, and cancel

"Something is failing, slow, or hanging — how do I diagnose or recover?" —
cancellation, timeouts, progress headers, server-side error surfaces, and number
precision pitfalls.

| Example                                           | Node                                                                                                                           | Web                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Ping against a host that does not exist           | [node/troubleshooting/ping_non_existing_host.ts](node/troubleshooting/ping_non_existing_host.ts)                               | [web/troubleshooting/ping_non_existing_host.ts](web/troubleshooting/ping_non_existing_host.ts)                               |
| Ping that times out (Node.js only)                | [node/troubleshooting/ping_timeout.ts](node/troubleshooting/ping_timeout.ts)                                                   | —                                                                                                                            |
| Cancelling an outgoing request                    | [node/troubleshooting/abort_request.ts](node/troubleshooting/abort_request.ts)                                                 | [web/troubleshooting/abort_request.ts](web/troubleshooting/abort_request.ts)                                                 |
| Cancelling a query on the server                  | [node/troubleshooting/cancel_query.ts](node/troubleshooting/cancel_query.ts)                                                   | [web/troubleshooting/cancel_query.ts](web/troubleshooting/cancel_query.ts)                                                   |
| Long-running queries via progress headers         | [node/troubleshooting/long_running_queries_progress_headers.ts](node/troubleshooting/long_running_queries_progress_headers.ts) | [web/troubleshooting/long_running_queries_progress_headers.ts](web/troubleshooting/long_running_queries_progress_headers.ts) |
| Long-running queries via request cancellation     | [node/troubleshooting/long_running_queries_cancel_request.ts](node/troubleshooting/long_running_queries_cancel_request.ts)     | —                                                                                                                            |
| Read-only user limitations (server error surface) | [node/troubleshooting/read_only_user.ts](node/troubleshooting/read_only_user.ts)                                               | [web/troubleshooting/read_only_user.ts](web/troubleshooting/read_only_user.ts)                                               |
| Custom JSON `parse`/`stringify` (BigInt)          | [node/troubleshooting/custom_json_handling.ts](node/troubleshooting/custom_json_handling.ts)                                   | [web/troubleshooting/custom_json_handling.ts](web/troubleshooting/custom_json_handling.ts)                                   |

### `security/` — TLS, RBAC, and safe parameterization

"How do I run securely?" — TLS (basic and mutual), role-based access, read-only
users, and SQL-injection-safe parameter binding.

| Example                                    | Node                                                                                                                       | Web                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Basic TLS authentication (Node.js only)    | [node/security/basic_tls.ts](node/security/basic_tls.ts)                                                                   | —                                                                                                                        |
| Mutual TLS authentication (Node.js only)   | [node/security/mutual_tls.ts](node/security/mutual_tls.ts)                                                                 | —                                                                                                                        |
| Read-only user limitations                 | [node/security/read_only_user.ts](node/security/read_only_user.ts)                                                         | [web/security/read_only_user.ts](web/security/read_only_user.ts)                                                         |
| Using one or more roles                    | [node/security/role.ts](node/security/role.ts)                                                                             | [web/security/role.ts](web/security/role.ts)                                                                             |
| Query parameter binding                    | [node/security/query_with_parameter_binding.ts](node/security/query_with_parameter_binding.ts)                             | [web/security/query_with_parameter_binding.ts](web/security/query_with_parameter_binding.ts)                             |
| Query parameter binding with special chars | [node/security/query_with_parameter_binding_special_chars.ts](node/security/query_with_parameter_binding_special_chars.ts) | [web/security/query_with_parameter_binding_special_chars.ts](web/security/query_with_parameter_binding_special_chars.ts) |

### `schema-and-deployments/` — DDL and target deployments

"How do I create tables and target different deployments?" — single-node,
on-premise cluster, ClickHouse Cloud, column-shape features, and
deployment-shaped connection strings.

| Example                                    | Node                                                                                                                             | Web                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Single-node deployment                     | [node/schema-and-deployments/create_table_single_node.ts](node/schema-and-deployments/create_table_single_node.ts)               | [web/schema-and-deployments/create_table_single_node.ts](web/schema-and-deployments/create_table_single_node.ts)               |
| On-premise cluster                         | [node/schema-and-deployments/create_table_on_premise_cluster.ts](node/schema-and-deployments/create_table_on_premise_cluster.ts) | [web/schema-and-deployments/create_table_on_premise_cluster.ts](web/schema-and-deployments/create_table_on_premise_cluster.ts) |
| ClickHouse Cloud                           | [node/schema-and-deployments/create_table_cloud.ts](node/schema-and-deployments/create_table_cloud.ts)                           | [web/schema-and-deployments/create_table_cloud.ts](web/schema-and-deployments/create_table_cloud.ts)                           |
| Insert into a table with ephemeral columns | [node/schema-and-deployments/insert_ephemeral_columns.ts](node/schema-and-deployments/insert_ephemeral_columns.ts)               | [web/schema-and-deployments/insert_ephemeral_columns.ts](web/schema-and-deployments/insert_ephemeral_columns.ts)               |
| Insert excluding columns                   | [node/schema-and-deployments/insert_exclude_columns.ts](node/schema-and-deployments/insert_exclude_columns.ts)                   | [web/schema-and-deployments/insert_exclude_columns.ts](web/schema-and-deployments/insert_exclude_columns.ts)                   |
| Client configuration via URL parameters    | [node/schema-and-deployments/url_configuration.ts](node/schema-and-deployments/url_configuration.ts)                             | [web/schema-and-deployments/url_configuration.ts](web/schema-and-deployments/url_configuration.ts)                             |

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

This will create two local ClickHouse instances: one with plain authentication
and one that requires [TLS](#tls-examples).

### Any example except `create_table_*`

Each subdirectory (`node` and `web`) is a fully independent npm package with its
own `package.json`, `tsconfig.json`, `eslint.config.mjs`, and Vitest runner
config — they do not share any configuration with the repository root. Install
dependencies in the subdirectory matching the example you want to run:

```sh
# For Node.js examples
cd examples/node
npm i

# For Web examples
cd examples/web
npm i
```

Then, you should be able to run any sample program by pointing `tsx` at its
category-relative path, for example:

```sh
# from examples/node
npx tsx --transpile-only coding/array_json_each_row.ts
npx tsx --transpile-only performance/insert_streaming_with_backpressure.ts

# from examples/web
npx tsx --transpile-only coding/array_json_each_row.ts
```

### TLS examples

You will need to add `server.clickhouseconnect.test` to your `/etc/hosts` to
make it work, as self-signed certificates are used in these examples.

Execute the following command to add the required `/etc/hosts` entry:

```bash
sudo -- sh -c "echo 127.0.0.1 server.clickhouseconnect.test >> /etc/hosts"
```

After that, you should be able to run the examples (from `examples/node`):

```bash
npx tsx --transpile-only security/basic_tls.ts
npx tsx --transpile-only security/mutual_tls.ts
npx tsx --transpile-only schema-and-deployments/create_table_on_premise_cluster.ts
```

### ClickHouse Cloud examples

- for `*_cloud.ts` examples, Docker containers are not required, but you need to
  set some environment variables first for the Node.js client:

```sh
export CLICKHOUSE_CLOUD_URL=https://<your-clickhouse-cloud-hostname>:8443
export CLICKHOUSE_CLOUD_PASSWORD=<your-clickhouse-cloud-password>
```

and for the Web client, you need to set these variables in the examples
themselves.

You can obtain these credentials in the ClickHouse Cloud console (check
[the docs](https://clickhouse.com/docs/en/integrations/language-clients/javascript#gather-your-connection-details)
for more information).

Cloud examples assume that you are using the `default` user and database.

Run one of the Cloud examples (from `examples/node`):

```
npx tsx --transpile-only schema-and-deployments/create_table_cloud.ts
```

### Environment variables for runnable examples

The following environment variables control behavior when running examples in
automated environments (e.g., CI):

- `CLICKHOUSE_CLUSTER_URL` — Overrides the URL for on-premise cluster examples.
  Default: `http://localhost:8127`.

- `CLICKHOUSE_CLOUD_URL` / `CLICKHOUSE_CLOUD_PASSWORD` — When both are set, the
  Cloud examples (`*_cloud.ts`) connect to the specified ClickHouse Cloud
  instance. When unset, these examples do not skip automatically and will fail
  because the required Cloud configuration is missing.

## Editing duplicated examples

A handful of examples live in more than one category folder so each category
remains a self-contained skill corpus. The current duplicates are:

| Logical example                                 | Primary location | Secondary copies           |
| ----------------------------------------------- | ---------------- | -------------------------- |
| `async_insert.ts`                               | `coding/`        | `performance/` (Node only) |
| `insert_from_select.ts`                         | `coding/`        | `performance/` (Node only) |
| `ping_non_existing_host.ts`                     | `coding/`        | `troubleshooting/`         |
| `custom_json_handling.ts`                       | `coding/`        | `troubleshooting/`         |
| `query_with_parameter_binding.ts`               | `coding/`        | `security/`                |
| `query_with_parameter_binding_special_chars.ts` | `coding/`        | `security/`                |
| `insert_ephemeral_columns.ts`                   | `coding/`        | `schema-and-deployments/`  |
| `insert_exclude_columns.ts`                     | `coding/`        | `schema-and-deployments/`  |
| `url_configuration.ts`                          | `coding/`        | `schema-and-deployments/`  |
| `read_only_user.ts`                             | `security/`      | `troubleshooting/`         |

When you change a duplicated example, update **every copy** in both `node/` and
`web/` (where applicable). Only the primary copy is executed by the Vitest
runner; the secondary copies are excluded in
[`examples/node/vitest.config.ts`](node/vitest.config.ts) and
[`examples/web/vitest.config.ts`](web/vitest.config.ts).
