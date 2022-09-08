# Contributing notes
ClickHouse js client is an open-source project, and we welcome any contributions from the community. Please share your ideas, contribute to the codebase, and help us maintain up-to-date documentation.

## Getting started
### Set up environment
You have installed:
- a compatible LTS version of nodejs: `v14.x` or `v16.x`
- NPM >= `6.x`

### Create a fork of the repository and clone it
```bash
git clone https://github.com/[YOUR_USERNAME]/clickhouse-js
cd clickhouse-js
```

### Install dependencies
```bash
npm i
```

## Testing
Whenever you add a new feature to the package or fix a bug, we strongly encourage you to add appropriate tests to ensure everyone in the community can safely benefit from your contribution.

### Tooling
We use [jest](https://jestjs.io/) as a test runner.
All the testing scripts are run with `jest-silent-reporter`.

### Running unit tests

Does not require a running ClickHouse server.

```bash
npm run test:unit
```

### Running integration tests

Integration tests use a running ClickHouse server in Docker or the Cloud.

`CLICKHOUSE_TEST_ENVIRONMENT` environment variable is used to switch between testing modes.

There are three possible options:
- `local_single_node` (default)
- `local_cluster`
- `cloud`

The main difference will be in table definitions, as having different engines in different setups is required.
Any `insert*.test.ts` can be a good example of that. Additionally, there is a slightly different test client creation when using Cloud, as we need credentials.

#### Local single node integration tests

Used when `CLICKHOUSE_TEST_ENVIRONMENT` is omitted or set to `local_single_node`.

Start a single ClickHouse server using Docker compose:

```bash
docker-compose up -d
```

and then run the tests:

```bash
npm run test:integration
```

#### Local two nodes cluster integration tests

Used when `CLICKHOUSE_TEST_ENVIRONMENT` is set to `local_cluster`.

Start a ClickHouse cluster using Docker compose:

```bash
docker compose -f docker-compose.cluster.yml up -d
```

and then run the tests:

```bash
npm run test:integration:local_cluster
```

#### Cloud integration tests

Used when `CLICKHOUSE_TEST_ENVIRONMENT` is set to `cloud`.

Two environment variables will be required to connect to the cluster in the Cloud.
You can obtain it after creating an instance in the Control Plane.

```bash
CLICKHOUSE_CLOUD_HOST=<host>
CLICKHOUSE_CLOUD_PASSWORD=<password>;
```

Given these environment variables are set, you can run the tests:

```bash
npm run test:integration:cloud
```

## CI
GitHub Actions should execute integration test jobs in parallel after we complete the TypeScript type check, lint check, and unit tests.

```
Build + Unit tests
├─ Integration tests (single local node in Docker)
├─ Integration tests (a cluster of local two nodes in Docker)
└─ Integration tests (Cloud)
```

## Style Guide
We use an automatic code formatting with `prettier` and `eslint`.
