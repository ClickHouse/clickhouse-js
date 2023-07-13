# ClickHouse Node.JS client examples

## How to run

### Any example except `create_table_*`

Start a local ClickHouse first (from the root project folder):

```sh
docker-compose up -d
```

Change the working directory to examples:

```sh
cd examples
```

Then, you should be able to run the sample programs:

```sh
ts-node --transpile-only --project tsconfig.json array_json_each_row.ts
```

### TLS examples

You need to add `server.clickhouseconnect.test` to your `/etc/hosts` to make it work.

```bash
sudo -- sh -c "echo 127.0.0.1 server.clickhouseconnect.test >> /etc/hosts"
```

After that, you should be able to run the examples:

```bash
ts-node --transpile-only --project tsconfig.json basic_tls.ts
ts-node --transpile-only --project tsconfig.json mutual_tls.ts
```

### Create table examples

- for `create_table_local_cluster.ts`, you will need to start a local cluster first:

```sh
docker-compose -f docker-compose.cluster.yml up -d
```

then run the example:

```
ts-node --transpile-only --project tsconfig.json create_table_local_cluster.ts
```

- for `create_table_cloud.ts`, Docker containers are not required, but you need to set some environment variables first:

```sh
export CLICKHOUSE_HOST=https://<your-clickhouse-cloud-hostname>:8443
export CLICKHOUSE_PASSWORD=<your-clickhouse-cloud-password>
```
You can obtain these credentials in the Cloud console.
This example assumes that you do not add any users or databases
to your Cloud instance, so it is `default` for both.

Run the example:

```
ts-node --transpile-only --project tsconfig.json create_table_cloud.ts
```
