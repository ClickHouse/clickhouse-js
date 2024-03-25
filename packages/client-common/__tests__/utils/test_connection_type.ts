export enum TestConnectionType {
  Node = 'node',
  Browser = 'browser',
}
export function getTestConnectionType(): TestConnectionType {
  let connectionType
  switch (process.env['CLICKHOUSE_TEST_CONNECTION_TYPE']) {
    case 'browser':
      connectionType = TestConnectionType.Browser
      break
    case 'node':
    case undefined:
      connectionType = TestConnectionType.Node
      break
    default:
      throw new Error(
        'Unexpected CLICKHOUSE_TEST_CONNECTION_TYPE value. ' +
          'Possible options: `node`, `browser` ' +
          'or keep it unset to fall back to `node`',
      )
  }
  return connectionType
}
