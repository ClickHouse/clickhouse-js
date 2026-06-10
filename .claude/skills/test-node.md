Run the Node.js unit and integration tests to verify changes to the `packages/client-node` package.

After making changes to the node package, run both test suites:

- Unit tests (fast, no server needed):

```
npm run test:node:unit
```

- Integration tests (requires a running ClickHouse server):

```
npm run test:node:integration
```

Run unit tests first. If they pass, also always run integration tests.

Proceed with addressing any failures before continuing.
