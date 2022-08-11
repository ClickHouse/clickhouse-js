# ClickHouse Node.JS client [![run tests](https://github.com/ClickHouse/clickhouse-js/actions/workflows/run-tests.yml/badge.svg?branch=main)](https://github.com/ClickHouse/clickhouse-js/actions/workflows/run-tests.yml)

## Requirements

- Node.JS 14.x or 16.x
- Docker compose

## Running unit tests

Does not require a running ClickHouse server.

```bash
npm run test:unit
```

## Running integration tests

Integration tests use a running ClickHouse server, either in Docker or in the Cloud.

`CLICKHOUSE_TEST_ENVIRONMENT` environment variable is used to switch between testing modes.

There are three possible options - `local_single_node` (default), `local_cluster`, `cloud`.

The main difference will be in tables definitions, as it is required to have different engines in different setups.
Any `insert*.test.ts` can be a good example of that. Additionally, there is slightly different test client creation when using Cloud, as we need credentials there.

### Local single node integration tests

Used when `CLICKHOUSE_TEST_ENVIRONMENT` is omitted or set to `local_single_node`.

Start a single ClickHouse server using docker compose:

```bash
docker-compose up -d
```

and then run the tests:

```bash
npm run test:integration
```

### Local two nodes cluster integration tests

Used when `CLICKHOUSE_TEST_ENVIRONMENT` is set to `local_cluster`.

Start a ClickHouse cluster using docker compose:

```bash
docker compose -f docker-compose.cluster.yml up -d
```

and then run the tests:

```bash
npm run test:integration:local_cluster
```

### Cloud integration tests

Used when `CLICKHOUSE_TEST_ENVIRONMENT` is set to `cloud`.

Three environment variables will be required to connect to the cluster in the Cloud.
You can obtain it after creating an instance in the Control Plane.

```bash
CLICKHOUSE_CLOUD_HOST=https://<host>:<port>
CLICKHOUSE_CLOUD_USERNAME=<username>
CLICKHOUSE_CLOUD_PASSWORD=<password>;
```

Given these environment variables are set, you can run the tests:

```bash
npm run test:integration:cloud
```

## GitHub Actions

Integration tests jobs should be executed in parallel after we complete usual TypeScript stuff like compile and lint, as well as unit tests.

```
Build + Unit tests
├─ Integration tests (local single node in Docker)
├─ Integration tests (local two nodes cluster in Docker)
└─ Integration tests (cloud)
```
