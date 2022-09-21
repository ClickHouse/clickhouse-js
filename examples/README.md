# ClickHouse Node.JS client examples

## How to run

All commands are written with an assumption that you are in the root project folder.

### Any example except `create_table_*`

Start a local ClickHouse first:

```sh
docker-compose up -d
```

then you can run some sample program:

```sh
ts-node --transpile-only --project tsconfig.dev.json examples/array_json_each_row.ts
```



### Create table examples

- for `create_table_local_cluster.ts`,
  you will need to start a local cluster first:

```sh
docker-compose -f docker-compose.cluster.yml up -d
```

then run the example:

```
ts-node --transpile-only examples/create_table_local_cluster.ts
```

- for `create_table_cloud.ts`, Docker containers are not required,
  but you need to set some environment variables first:

```sh
export CLICKHOUSE_HOST=https://<your-clickhouse-cloud-hostname>:8443
export CLICKHOUSE_PASSWORD=<your-clickhouse-cloud-password>
```
You can obtain these credentials in the Cloud console.
This example assumes that you do not add any users or databases
to your Cloud instance, so it is `default` for both.

Run the example:

```
ts-node --transpile-only examples/create_table_cloud.ts
```
