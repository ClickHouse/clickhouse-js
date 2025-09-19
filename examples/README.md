# ClickHouse JS client examples

Examples located directly in `examples` directory should work with both Node.js and Web versions of the client.
The only difference will be in the import statement - `@clickhouse/client` vs `@clickhouse/client-web`.

Node.JS-specific examples are located in the `examples/node` directory.

## Overview

We aim to cover various scenarios of client usage with these examples. You should be able to run any of these examples, see [How to run](#how-to-run) section below.

If something is missing, or you found a mistake in one of these examples, please open an issue or a pull request, or [contact us](../README.md#contact-us).

#### General usage

- [url_configuration.ts](url_configuration.ts) - client configuration using the URL parameters.
- [clickhouse_settings.ts](clickhouse_settings.ts) - ClickHouse settings on the client side, both global and per operation.
- [ping.ts](ping.ts) - sample checks if the server can be reached.
- [abort_request.ts](abort_request.ts) - cancelling an outgoing request or a read-only query.
- [cancel_query.ts](cancel_query.ts) - cancelling a potentially long-running query on the server side.
- [long_running_queries_timeouts.ts](long_running_queries_timeouts.ts) - avoiding timeout errors for long-running queries (two different approaches).
- [read_only_user.ts](read_only_user.ts) - an example of using the client with a read-only user, with possible read-only user limitations highlights.
- [basic_tls.ts](node/basic_tls.ts) - (Node.js only) using certificates for basic TLS authentication.
- [mutual_tls.ts](node/mutual_tls.ts) - (Node.js only) using certificates for mutual TLS authentication.

#### Creating tables

- [create_table_single_node.ts](create_table_single_node.ts) - creating a table on a single-node deployment.
- [create_table_on_premise_cluster.ts](create_table_on_premise_cluster.ts) - creating a table on a multi-node deployment when macro values are required to be present in the DDL for Replicated tables.
- [create_table_cloud.ts](create_table_cloud.ts) - creating a table in ClickHouse Cloud.

#### Inserting data

- [array_json_each_row.ts](array_json_each_row.ts) - a simple insert of an array of values using `JSONEachRow` format.
- [insert_data_formats_overview.ts](insert_data_formats_overview.ts) - an overview of available data formats for inserting data.
- [async_insert.ts](async_insert.ts) - server-side batching using async inserts; the client will be waiting for a written batch ack.
- [async_insert_without_waiting.ts](async_insert_without_waiting.ts) - server-side batching using async inserts; the client will not be waiting for a written batch ack. This is a bit more advanced async insert example simulating an event listener.
- [insert_exclude_columns.ts](insert_exclude_columns.ts) - inserting into specific columns only, or excluding certain columns from the INSERT statement.
- [insert_from_select.ts](insert_from_select.ts) - `INSERT FROM SELECT` example, using the `command` method instead of the default `insert`.
- [insert_into_different_db.ts](insert_into_different_db.ts) - inserting data into a table in a different database, regardless of the database provided in the connection settings.
- [insert_decimals.ts](insert_decimals.ts) - inserting decimal values into ClickHouse using `JSONEachRow` format.
- [insert_js_dates.ts](insert_js_dates.ts) - an example of inserting objects that contain JS Date into ClickHouse.
- [insert_file_stream_csv.ts](node/insert_file_stream_csv.ts) - (Node.js only) stream a CSV file into ClickHouse.
- [insert_file_stream_ndjson.ts](node/insert_file_stream_ndjson.ts) - (Node.js only) stream a NDJSON file into ClickHouse.
- [insert_file_stream_parquet.ts](node/insert_file_stream_parquet.ts) - (Node.js only) stream a Parquet file into ClickHouse.
- [insert_arbitrary_format_stream.ts](node/insert_arbitrary_format_stream.ts) - (Node.js only) stream in arbitrary format into ClickHouse. In this case, the input format is [AVRO](https://clickhouse.com/docs/interfaces/formats/Avro), inserting the data from an Avro data file generated ad-hoc.
- [stream_created_from_array_raw.ts](node/stream_created_from_array_raw.ts) - (Node.js only) converting the string input into a stream and sending it to ClickHouse; in this scenario, the base input is a CSV string.
- [insert_streaming_with_backpressure.ts](node/insert_streaming_with_backpressure.ts) - (Node.js only) advanced streaming INSERT example with proper backpressure handling, demonstrating how to handle high-throughput scenarios where your application pushes data to the stream.
- [insert_streaming_backpressure_simple.ts](node/insert_streaming_backpressure_simple.ts) - (Node.js only) simple streaming INSERT example with backpressure handling, showing the essential pattern for streaming data from your application to ClickHouse.
- [insert_values_and_functions.ts](insert_values_and_functions.ts) - generating an `INSERT INTO ... VALUES` statement that uses a combination of values and function calls.
- [insert_ephemeral_columns.ts](insert_ephemeral_columns.ts) - inserting data into a table that has [ephemeral columns](https://clickhouse.com/docs/en/sql-reference/statements/create/table#ephemeral).

#### Selecting data

- [select_json_each_row.ts](select_json_each_row.ts) - simple select of the data in the `JSONEachRow` format.
- [select_data_formats_overview.ts](select_data_formats_overview.ts) - an overview of all available data formats for select queries.
- [select_json_with_metadata.ts](select_json_with_metadata.ts) - select result as a JSON object with query metadata.
- [query_with_parameter_binding.ts](query_with_parameter_binding.ts) - query parameter binding example.
- [select_parquet_as_file.ts](node/select_parquet_as_file.ts) - (Node.js only) select data from ClickHouse and save it as a Parquet file. This example can be adjusted to save the data in other formats, such as CSV/TSV/TabSeparated, by changing the format in the query.
- [select_streaming_json_each_row.ts](node/select_streaming_json_each_row.ts) - (Node.js only) streaming JSON\* formats from ClickHouse and processing it with `on('data')` event.
- [select_streaming_json_each_row_for_await.ts](node/select_streaming_json_each_row_for_await.ts) - (Node.js only) similar to [select_streaming_json_each_row.ts](node/select_streaming_json_each_row.ts), but using the `for await` loop syntax.
- [select_streaming_text_line_by_line.ts](node/select_streaming_text_line_by_line.ts) - (Node.js only) streaming text formats from ClickHouse and processing it line by line. In this example, CSV format is used.
- [select_json_each_row_with_progress.ts](node/select_json_each_row_with_progress.ts) - streaming using `JSONEachRowWithProgress` format, checking for the progress rows in the stream.

#### Data types

- [dynamic_variant_json.ts](./dynamic_variant_json.ts) - using experimental [Dynamic](https://clickhouse.com/docs/en/sql-reference/data-types/dynamic)/[Variant](https://clickhouse.com/docs/en/sql-reference/data-types/variant)/[JSON](https://clickhouse.com/docs/en/sql-reference/data-types/newjson) data types with [JSONEachRow](https://clickhouse.com/docs/en/interfaces/formats#jsoneachrow) format.
- [time_time64.ts](./time_time64.ts) - using [Time](https://clickhouse.com/docs/en/sql-reference/data-types/time) and [Time64](https://clickhouse.com/docs/en/sql-reference/data-types/time64) data types with [JSONEachRow](https://clickhouse.com/docs/en/interfaces/formats#jsoneachrow) format (ClickHouse 25.6+).

#### Special cases

- [default_format_setting.ts](default_format_setting.ts) - sending queries using `exec` method without a `FORMAT` clause; the default format will be set from the client settings.
- [session_id_and_temporary_tables.ts](session_id_and_temporary_tables.ts) - creating a temporary table, which requires a session_id to be passed to the server.
- [session_level_commands.ts](session_level_commands.ts) - using SET commands, memorized for the specific session_id.
- [role.ts](role.ts) - using one or more roles without explicit `USE` commands or session IDs

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

This will create two local ClickHouse instances: one with plain authentication and one that requires [TLS](#tls-examples).

### Any example except `create_table_*`

Change the working directory to `examples` and install the dependencies:

```sh
cd examples
npm i
```

Then, you should be able to run the sample programs, for example:

```sh
ts-node --transpile-only array_json_each_row.ts
```

### TLS examples

You will need to add `server.clickhouseconnect.test` to your `/etc/hosts` to make it work, as self-signed certificates are used in these examples.

Execute the following command to add the required `/etc/hosts` entry:

```bash
sudo -- sh -c "echo 127.0.0.1 server.clickhouseconnect.test >> /etc/hosts"
```

After that, you should be able to run the examples:

```bash
ts-node --transpile-only node/basic_tls.ts
ts-node --transpile-only node/mutual_tls.ts
```

### On-premise cluster examples

For `create_table_on_premise_cluster.ts`, you will need to start a local cluster first.

Run this command from the root folder of this repository:

```sh
docker-compose -f docker-compose.cluster.yml up -d
```

Now, you should be able to run the example:

```
ts-node --transpile-only create_table_on_premise_cluster.ts
```

### ClickHouse Cloud examples

- for `*_cloud.ts` examples, Docker containers are not required, but you need to set some environment variables first:

```sh
export CLICKHOUSE_URL=https://<your-clickhouse-cloud-hostname>:8443
export CLICKHOUSE_PASSWORD=<your-clickhouse-cloud-password>
```

You can obtain these credentials in the ClickHouse Cloud console (check [the docs](https://clickhouse.com/docs/en/integrations/language-clients/javascript#gather-your-connection-details) for more information).

Cloud examples assume that you are using the `default` user and database.

Run one of the Cloud examples:

```
ts-node --transpile-only create_table_cloud.ts
```
