import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ClickHouseError,
  type ClickHouseClient,
} from "@clickhouse/client-common";
import { createTestClient, guid, isOnEnv, TestEnv } from "../utils";

// query() sends its format as the `default_format` setting on every request,
// so a user whose profile locks that setting cannot run it. This is a known
// behavior change, mentioned in the changelog.
describe.skipIf(!isOnEnv(TestEnv.LocalSingleNode))(
  "query() with a locked default_format",
  () => {
    let adminClient: ClickHouseClient;
    let client: ClickHouseClient;
    let username: string;
    // Older servers do not accept default_format in a user profile at all.
    let supported = true;

    beforeAll(async () => {
      adminClient = createTestClient();
      username = `clickhousejs__locked_default_format_${guid()}`;
      const password = `CHJS_${guid()};`;
      try {
        await adminClient.command({
          query: `
            CREATE USER ${username}
            IDENTIFIED WITH sha256_password BY '${password}'
            SETTINGS default_format = 'TabSeparated' CONST
          `,
        });
      } catch (err) {
        if (!/Unknown setting|UNKNOWN_SETTING/.test(String(err))) {
          throw err;
        }
        supported = false;
        return;
      }
      client = createTestClient({ username, password });
    });

    afterAll(async () => {
      if (supported) {
        await client.close();
        await adminClient.command({ query: `DROP USER IF EXISTS ${username}` });
      }
      await adminClient.close();
    });

    it("fails with SETTING_CONSTRAINT_VIOLATION", async (ctx) => {
      if (!supported) {
        ctx.skip();
      }
      const error = await client
        .query({ query: "SELECT 1", format: "JSONEachRow" })
        .then(
          () => undefined,
          (err: unknown) => err,
        );
      expect(error).toBeInstanceOf(ClickHouseError);
      expect(error).toMatchObject({
        code: "452",
        type: "SETTING_CONSTRAINT_VIOLATION",
      });
    });

    it("still allows exec() with no default_format of its own", async (ctx) => {
      if (!supported) {
        ctx.skip();
      }
      const { stream } = await client.exec({ query: "SELECT 1" });
      // exec() sends no default_format, so the user's locked one applies.
      if (stream instanceof ReadableStream) {
        await stream.cancel();
      } else {
        (stream as { destroy: () => void }).destroy();
      }
    });
  },
);
