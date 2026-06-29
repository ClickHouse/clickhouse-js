# @clickhouse/client-web

Official Web client for [ClickHouse](https://clickhouse.com/), written purely in
TypeScript and thoroughly tested against actual ClickHouse versions.

It is built on top of the
[Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) and
[Web Streams](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API) APIs
and supports streaming for selects. It is compatible with Chrome/Firefox
browsers and Cloudflare Workers. The client has zero external dependencies and is
optimized for maximum performance.

> Running on Node.js? Use
> [`@clickhouse/client`](https://www.npmjs.com/package/@clickhouse/client)
> instead, which additionally supports streaming for inserts.

## Installation

```sh
npm i @clickhouse/client-web
```

## Environment requirements

The client targets runtimes that provide the standard
[Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) and
[Web Streams](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API) APIs,
such as modern Chrome/Firefox browsers and Cloudflare Workers.

If using TypeScript, version
[4.5](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-5.html)
or above is required to enable
[inline import and export syntax](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-5.html#type-modifiers-on-import-names).

## Compatibility with ClickHouse

| Client version | ClickHouse |
| -------------- | ---------- |
| 1.12.0+        | 24.8+      |

The client may work with older versions too; however, this is best-effort
support and is not guaranteed.

## Quick start

```ts
import { createClient } from "@clickhouse/client-web";

const client = createClient({
  url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
});

const resultSet = await client.query({
  query: "SELECT * FROM system.tables",
  format: "JSONEachRow",
});

const tables = await resultSet.json();
console.log(tables);

await client.close();
```

See more examples in the
[examples directory](https://github.com/ClickHouse/clickhouse-js/tree/main/examples).

## Documentation

See the [ClickHouse website](https://clickhouse.com/docs/integrations/javascript)
for the full documentation.

## Changelog

See [`CHANGELOG.md`](https://github.com/ClickHouse/clickhouse-js/blob/main/packages/client-web/CHANGELOG.md).

## Contact us

If you have any questions or need help, feel free to reach out to us in the
[Community Slack](https://clickhouse.com/slack) (`#clickhouse-js` channel) or
via [GitHub issues](https://github.com/ClickHouse/clickhouse-js/issues).

## License

[Apache 2.0](https://github.com/ClickHouse/clickhouse-js/blob/main/LICENSE)
