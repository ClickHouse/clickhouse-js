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

Official JS client for [ClickHouse](https://clickhouse.com/), written purely in TypeScript with zero dependencies. The client is optimized for maximum performance and thoroughly tested with various ClickHouse versions and configurations (on-premise single node, on-premise cluster, and ClickHouse Cloud).

The repository consists of three packages:

- `@clickhouse/client` - a version of the client designed for Node.js platform only. It is built on top of [HTTP](https://nodejs.org/api/http.html)
  and [Stream](https://nodejs.org/api/stream.html) APIs; supports streaming for both selects and inserts.
- `@clickhouse/client-web` - a version of the client built on top of [Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
  and [Web Streams](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API) APIs; supports streaming for selects.
  Compatible with Chrome/Firefox browsers, React/Vue/Angular applications, and CloudFlare workers.
- `@clickhouse/client-common` - shared common types and the base framework for building a custom client implementation.

## Features

- Written entirely in TypeScript with strong typing for the client public API and all ClickHouse settings
- Zero dependencies for enhanced security and reduced bundle size
- HTTP(s) protocol with persistent connection and Keep-Alive support
- HTTP request and response compression (GZIP)
- Streaming API for both data insertion and selection
- Support for various data formats: JSON, CSV, TabSeparated, CustomSeparated, Parquet families
- Parametrized queries to avoid SQL injection
- Request cancellation and timeouts
- Custom logger support
- Compatible with ClickHouse Cloud and on-premise deployments

## Installation

Install the Node.js client:

```bash
npm i @clickhouse/client
```

Install the Web client:

```bash
npm i @clickhouse/client-web
```

## Requirements

### Node.js Environment

The client is compatible with all [maintained](https://github.com/nodejs/release#readme) Node.js releases. As soon as a Node.js version approaches End-Of-Life, the client drops support for it.

**Current Node.js versions support:**

| Node.js version | Supported?  |
| --------------- | ----------- |
| 24.x            | ✔           |
| 22.x            | ✔           |
| 20.x            | ✔           |
| 18.x            | Best effort |

### TypeScript

When using TypeScript, version 4.5 or higher is required to support [inline import and export syntax](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-5.html#type-modifiers-on-import-names).

### Web Environment

The web version (`@clickhouse/client-web`) is officially tested with the latest Chrome and Firefox browsers and can be used in:

- Modern web browsers (Chrome, Firefox)
- React, Vue, Angular applications
- CloudFlare workers

## Compatibility with ClickHouse

| Client version | ClickHouse |
| -------------- | ---------- |
| 1.12.0+        | 24.8+      |

The client will likely work with older ClickHouse versions as well; however, this is best-effort support and isn't guaranteed. If you have a ClickHouse version older than 23.3, please refer to the [ClickHouse security policy](https://github.com/ClickHouse/ClickHouse/blob/master/SECURITY.md) and consider upgrading.

## Documentation

See the [ClickHouse website](https://clickhouse.com/docs/en/integrations/language-clients/javascript) for the full documentation entry.

## Usage examples

We have a wide range of [examples](./examples), aiming to cover various scenarios of client usage. The overview is available in the [examples README](https://github.com/ClickHouse/clickhouse-js/blob/main/examples/README.md#overview).

## Contact us

If you have any questions or need help, feel free to reach out to us in the [Community Slack](https://clickhouse.com/slack) (`#clickhouse-js` channel) or via [GitHub issues](https://github.com/ClickHouse/clickhouse-js/issues).

## Contributing

Check out our [contributing guide](./CONTRIBUTING.md).
