## Getting started

ClickHouse js client is an open-source project,
and we welcome any contributions from the community.
Please share your ideas, contribute to the codebase,
and help us maintain up-to-date documentation.

### Set up environment

You have installed:

- a compatible LTS version of Node.js: `v20.x`, `v22.x` or `v24.x`
- NPM >= `9.x`

### Create a fork of the repository and clone it

```bash
git clone https://github.com/[YOUR_USERNAME]/clickhouse-js
cd clickhouse-js
```

### Install dependencies

```bash
npm i
```

### Add /etc/hosts entry

Required for TLS tests.
The generated certificates assume TLS requests use `server.clickhouseconnect.test` as the hostname.
See [tls.test.ts](packages/client-node/__tests__/tls/tls.test.ts) for more details.

```bash
sudo -- sh -c "echo 127.0.0.1 server.clickhouseconnect.test >> /etc/hosts"
```

### IDE setup

#### WebStorm

- Open settings
- Navigate to "Languages & Frameworks" -> "Typescript"
- Copy and paste `--project tsconfig.dev.json` into the options field to enable proper path resolution in tests

## Style Guide

We use an automatic code formatting with `prettier` and `eslint`, both should be installed after running `npm i`.

Additionally, every commit should trigger a [Husky](https://typicode.github.io/husky/) Git hook that applies `prettier`
and checks the code with `eslint` via `lint-staged` automatically.

## Testing

Whenever you add a new feature to the package or fix a bug,
we strongly encourage you to add appropriate tests to ensure
everyone in the community can safely benefit from your contribution.

### Tooling

We use [Vitest](https://vitest.dev/) as the test runner and the testing framework. It covers a variety of testing needs, including unit and integration tests, and supports both Node.js, Web environments and edge runtimes.

### Type checking and linting

Both checks can be run manually:

```bash
npm run typecheck
npm run lint:fix
```

However, usually, it is enough to rely on Husky Git hooks.

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

The main difference will be in table definitions,
as having different engines in different setups is required.
Any `insert*.test.ts` can be a good example of that.
Additionally, there is a slightly different test client creation when using Cloud,
as we need credentials.

#### Local single node integration tests

Used when `CLICKHOUSE_TEST_ENVIRONMENT` is omitted or set to `local_single_node`.

Start a single ClickHouse server using Docker compose:

```bash
docker-compose up -d
```

Run the tests (Node.js):

```bash
npm run test:node:integration
```

Run the tests (Web):

```bash
npm run test:web:integration
```

#### Running TLS integration tests

Basic and mutual TLS certificates tests, using `clickhouse_tls` server container.

Start the containers first:

```bash
docker-compose up -d
```

and then run the tests (Node.js only):

```bash
npm run test:node:tls
```

#### Local two nodes cluster integration tests

Used when `CLICKHOUSE_TEST_ENVIRONMENT` is set to `local_cluster`.

Start a ClickHouse cluster using Docker compose:

```bash
docker compose -f docker-compose.cluster.yml up -d
```

Run the tests (Node.js):

```bash
npm run test:node:integration:local_cluster
```

Run the tests (Web):

```bash
npm run test:web:integration:local_cluster
```

#### Cloud integration tests

Used when `CLICKHOUSE_TEST_ENVIRONMENT` is set to `cloud`.

Two environment variables will be required to connect to the cluster in the Cloud.
You can obtain it after creating an instance in the Control Plane.

```bash
CLICKHOUSE_CLOUD_HOST=<host>
CLICKHOUSE_CLOUD_PASSWORD=<password>;
```

With these environment variables set, you can run the tests.

Node.js:

```bash
npm run test:node:integration:cloud
```

Web:

```bash
npm run test:web:integration:cloud
```

## CI

GitHub Actions should execute integration test jobs for both Node.js and Web versions in parallel
after we complete the TypeScript type check, lint check, and Node.js unit tests.

```
Typecheck + Lint + Node.js client unit tests
├─ Node.js client integration + TLS tests (single local node in Docker)
├─ Node.js client integration tests (a cluster of local two nodes in Docker)
├─ Node.js client integration tests (Cloud)
├─ Web client integration tests (single local node in Docker)
├─ Web client integration tests (a cluster of local two nodes in Docker)
└─ Web client integration tests (Cloud)
```

## Test Coverage

The average reported test coverage is above 90%. We generally aim towards this threshold, if it deems reasonable.

Currently, automatic coverage reports are disabled.
See [#177](https://github.com/ClickHouse/clickhouse-js/issues/177), as it should be restored in the scope of that issue.

## Release process

Tools required:

- Node.js >= `20.x`
- NPM >= `11.x`
- jq (https://stedolan.github.io/jq/)

We prefer to keep versions the same across the packages, and release all at once, even if there were no changes in some.

Make sure that the working directory is clean:

```bash
git clean -dfX
npm i
```

```bash
export NEW_VERSION=[new_version]
.scripts/update_version.sh $NEW_VERSION
```

Then build the packages:

```bash
npm run build
```

Now we're ready to publish the beta version for testing:

```bash
npm login
npm --workspaces publish --tag=beta
```

After the package is published it can be tests in a separate project by installing it with the `beta` tag:

```bash
npm install @clickhouse/client@beta
```

After the beta testing is done, you can commit the changes, create a new Git tag and push it to the repository:

```bash
git add .
git commit -m "chore: bump version to $NEW_VERSION"
```

Promote the `beta` tag to `latest`:

```bash
npm dist-tag add @clickhouse/client-common@$NEW_VERSION latest
npm dist-tag add @clickhouse/client@$NEW_VERSION latest
npm dist-tag add @clickhouse/client-web@$NEW_VERSION latest
```

Check that the packages have been published correctly: <https://www.npmjs.com/org/clickhouse>

Create a PR and merge it after review.

The last step is to create a new Git tag and push it to the repository:

```bash
git tag "$NEW_VERSION"
git push origin tag "$NEW_VERSION"
```

Then create a new release in GitHub using the created tag and the corresponding changelog notes.

All done, thanks!
