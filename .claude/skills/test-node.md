Run the Node.js unit and integration tests to verify changes to `packages/client-node` (and `packages/client-native` when changes touch shared `client-common` code or Node.js client APIs/ResultSet).

After making changes to the Node.js client package(s), run the relevant test suites:

- HTTP Node.js client (`packages/client-node`):

```
npm run test:node:unit
npm run test:node:integration
```

- Native TCP Node.js client (`packages/client-native`), when modifying `packages/client-native`, `packages/client-common`, or shared Node.js client behavior (`src/index.ts`, `src/result_set.ts`, `src/utils/`):

```
npm run test:native:unit
npm run test:native:integration
```

Run unit tests (fast, no server needed) first. If they pass, also always run integration tests (requires a running ClickHouse server).

Proceed with addressing any failures before continuing.
