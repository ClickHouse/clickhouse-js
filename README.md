<p align="center">
<img src=".static/logo.svg" width="200px" align="center">
<h1 align="center">ClickHouse JS client</h1>
</p>
<br/>
<p align="center">
<a href="https://www.npmjs.com/package/@clickhouse/client">
<img alt="NPM Version" src="https://img.shields.io/npm/v/%40clickhouse%2Fclient?color=%233178C6&logo=npm">
</a>

<a href="https://www.npmjs.com/package/@clickhouse/client">
<img alt="NPM Downloads" src="https://img.shields.io/npm/dw/%40clickhouse%2Fclient?color=%233178C6&logo=npm">
</a>

<a href="https://github.com/ClickHouse/clickhouse-js/actions/workflows/tests.yml">
<img src="https://github.com/ClickHouse/clickhouse-js/actions/workflows/tests.yml/badge.svg?branch=main">
</a>

<a href="https://codecov.io/gh/ClickHouse/clickhouse-js">
<img src="https://codecov.io/gh/ClickHouse/clickhouse-js/graph/badge.svg?token=B832WB00WJ">
</a>

<img src="https://api.scorecard.dev/projects/github.com/ClickHouse/clickhouse-js/badge">
</p>

## About

Official JS client for [ClickHouse](https://clickhouse.com/), written purely in TypeScript, thoroughly tested with actual ClickHouse versions.

The client has zero external dependencies and is optimized for maximum performance.

The repository consists of three packages:

- `@clickhouse/client` - a version of the client designed for Node.js platform only. It is built on top of [HTTP](https://nodejs.org/api/http.html)
  and [Stream](https://nodejs.org/api/stream.html) APIs; supports streaming for both selects and inserts.
- `@clickhouse/client-web` - a version of the client built on top of [Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
  and [Web Streams](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API) APIs; supports streaming for selects.
  Compatible with Chrome/Firefox browsers and Cloudflare workers.
- `@clickhouse/client-common` - shared common types and the base framework for building a custom client implementation.

## Installation

Node.js client:

```sh
npm i @clickhouse/client
```

Web client (browsers, Cloudflare workers):

```sh
npm i @clickhouse/client-web
```

## Environment requirements

### Node.js

Node.js must be available in the environment to run the Node.js client. The client is compatible with all the [maintained](https://github.com/nodejs/release#readme) Node.js releases.

| Node.js version | Supported?  |
| --------------- | ----------- |
| 24.x            | ✔           |
| 22.x            | ✔           |
| 20.x            | ✔           |
| 18.x            | Best effort |

### TypeScript

If using TypeScript, version [4.5](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-5.html) or above is required to enable [inline import and export syntax](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-5.html#type-modifiers-on-import-names).

## Compatibility with ClickHouse

| Client version | ClickHouse |
| -------------- | ---------- |
| 1.12.0+        | 24.8+      |

The client may work with older versions too; however, this is best-effort support and is not guaranteed.

## Quick start

```ts
import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

const client = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
})

const resultSet = await client.query({
  query: 'SELECT * FROM system.tables',
  format: 'JSONEachRow',
})

const tables = await resultSet.json()
console.log(tables)

await client.close()
```

See more examples in the [examples directory](./examples).

## Documentation

See the [ClickHouse website](https://clickhouse.com/docs/integrations/javascript) for the full documentation.

## AI Agent Skills

This repository contains agent skills for working with the client:

- `clickhouse-js-node-troubleshooting` — troubleshooting playbook for the Node.js client.

Install via CLI:

```sh
# per project
npx skills add ClickHouse/clickhouse-js
# globally
npx skills add ClickHouse/clickhouse-js -g
```

Or ask your agent to install it for you:

> install agent skills from ClickHouse/clickhouse-js

## Usage examples

We have a wide range of [examples](./examples), aiming to cover various scenarios of client usage. The overview is available in the [examples README](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/README.md#overview).

## Contact us

If you have any questions or need help, feel free to reach out to us in the [Community Slack](https://clickhouse.com/slack) (`#clickhouse-js` channel) or via [GitHub issues](https://github.com/ClickHouse/clickhouse-js/issues).

## Contributing

Check out our [contributing guide](./CONTRIBUTING.md).
