// The `@clickhouse/client/undici` entry point (see `src/undici/index.ts`).
//
// This is a real file, so that native ESM can import it by its full path
// (`@clickhouse/client/undici/index.js`): ESM does not resolve a directory,
// and the package has no `exports` field. CommonJS, TypeScript and bundlers
// can also use `@clickhouse/client/undici` (see `package.json` in this folder).
module.exports = require("../dist/undici/index.js");
