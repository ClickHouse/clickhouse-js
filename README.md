<p align="center">
<img src=".static/logo.svg" width="200px" align="center">
<h1 align="center">ClickHouse JS client</h1>
</p>
<br/>
<p align="center">
<a href="https://github.com/ClickHouse/clickhouse-js/actions/workflows/tests.yml">
<img src="https://github.com/ClickHouse/clickhouse-js/actions/workflows/tests.yml/badge.svg?branch=main">
</a>
</p>

## About

Official JS client for [ClickHouse](https://clickhouse.com/), written purely in TypeScript,
thoroughly tested with actual ClickHouse versions.

The repository consists of three packages:

- `@clickhouse/client` - a version of the client designed for Node.js platform only. It is built on top of [HTTP](https://nodejs.org/api/http.html)
  and [Stream](https://nodejs.org/api/stream.html) APIs; supports streaming for both selects and inserts.
- `@clickhouse/client-web` - a version of the client built on top of [Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
  and [Web Streams](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API) APIs; supports streaming for selects.
  Compatible with Chrome/Firefox browsers and CloudFlare workers.
- `@clickhouse/client-common` - shared common types and the base framework for building a custom client implementation.

## Documentation

See the [ClickHouse website](https://clickhouse.com/docs/en/integrations/language-clients/javascript) for the full documentation entry.

## Usage examples

You can find code samples in the [examples](./examples) folder (with [README](./examples/README.md)).

## Contributing

Check out our [contributing guide](./CONTRIBUTING.md).
