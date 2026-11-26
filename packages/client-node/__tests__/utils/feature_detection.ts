export function isAwaitUsingStatementSupported(): boolean {
  try {
    eval(`
      (async () => {
          await using c = null;
      })
    `);
    return true;
  } catch {
    return false;
  }
}

export function isUsingStatementSupported(): boolean {
  try {
    eval(`
      (() => {
          using c = null;
      })
    `);
    return true;
  } catch {
    return false;
  }
}

/** `true` when the test suite runs with the optional undici transport
 *  (`CLICKHOUSE_TEST_TRANSPORT=undici`, see `vitest.setup.ts`). */
export function isUndiciTestTransport(): boolean {
  return process.env["CLICKHOUSE_TEST_TRANSPORT"] === "undici";
}
