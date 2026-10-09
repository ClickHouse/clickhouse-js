import { vi, describe, it, expect } from "vitest";
import { sleep } from "../utils/sleep";
import { ClickHouseClient, getInsertQuery } from "../../src/client";
import { createSimpleTestClient } from "../utils/simple_client";

function isAwaitUsingStatementSupported(): boolean {
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

function mockImpl(): any {
  return {
    make_connection: () => {
      return {} as any;
    },
    values_encoder: () => {
      return {} as any;
    },
  };
}

describe("client", () => {
  it("createSimpleTestClient creates a client without requiring ClickHouse", async () => {
    // Imported from the side-effect-free `simple_client` module, so it does not
    // register the shared `beforeAll` test-env init and needs no ClickHouse.
    const client = createSimpleTestClient();
    expect(client).toBeDefined();
    await client.close();
  });

  it.skipIf(!isAwaitUsingStatementSupported())(
    "closes the client when used with using statement",
    async () => {
      const client = new ClickHouseClient({
        url: "http://localhost",
        impl: mockImpl(),
      });
      let isClosed = false;
      vi.spyOn(client, "close").mockImplementation(async () => {
        // Simulate some delay in closing
        await sleep(0);
        isClosed = true;
      });

      // Wrap in eval to allow using statement syntax without
      // syntax error in older Node.js versions. Might want to
      // consider using a separate test file for this in the future.
      await eval(`
      (async (value) => {
          await using c = value;
          // do nothing, just testing the disposal at the end of the block
      })
    `)(client);

      expect(isClosed).toBeTruthy();
    },
  );

  describe("getInsertQuery table identifier quoting", () => {
    it.each([
      ['"my.table"', '"my.table"'],
      ["`my.table`", "`my.table`"],
      ['"my.db"."my.table"', '"my.db"."my.table"'],
      ['my_db."my.table"', '`my_db`."my.table"'],
      ['"my.db".my_table', '"my.db".`my_table`'],
      ['"my\\\".table"', '"my\\\".table"'],
      ['"my"".table"', '"my"".table"'],
      ["`my\\`.table`", "`my\\`.table`"],
    ])("preserves quoted dots in %s", (table, expected) => {
      expect(getInsertQuery({ table, values: [] }, "JSONEachRow")).toBe(
        `INSERT INTO ${expected} FORMAT JSONEachRow`,
      );
    });

    it("quotes plain table name with backticks", () => {
      const query = getInsertQuery(
        {
          table: "my_table",
          values: [],
        },
        "JSONEachRow",
      );
      expect(query).toBe("INSERT INTO `my_table` FORMAT JSONEachRow");
    });

    it("quotes hyphenated and special character table names", () => {
      const query = getInsertQuery(
        {
          table: "my-custom-table",
          values: [],
        },
        "JSONEachRow",
      );
      expect(query).toBe("INSERT INTO `my-custom-table` FORMAT JSONEachRow");
    });

    it("quotes qualified database and table names individually", () => {
      const query = getInsertQuery(
        {
          table: "my_db.my-table",
          values: [],
        },
        "JSONEachRow",
      );
      expect(query).toBe("INSERT INTO `my_db`.`my-table` FORMAT JSONEachRow");
    });

    it("preserves already quoted backtick or double quote identifiers", () => {
      const queryBacktick = getInsertQuery(
        {
          table: "`db`.`table`",
          values: [],
        },
        "JSONEachRow",
      );
      expect(queryBacktick).toBe("INSERT INTO `db`.`table` FORMAT JSONEachRow");

      const queryDoubleQuote = getInsertQuery(
        {
          table: '"db"."table"',
          values: [],
        },
        "JSONEachRow",
      );
      expect(queryDoubleQuote).toBe(
        'INSERT INTO "db"."table" FORMAT JSONEachRow',
      );
    });

    it("handles column list and column exceptions with quoted table name", () => {
      const queryColumns = getInsertQuery(
        {
          table: "my-table",
          columns: ["id", "name"],
          values: [],
        },
        "JSONEachRow",
      );
      expect(queryColumns).toBe(
        "INSERT INTO `my-table` (id, name) FORMAT JSONEachRow",
      );

      const queryExcept = getInsertQuery(
        {
          table: "my-table",
          columns: { except: ["temp_field"] },
          values: [],
        },
        "JSONEachRow",
      );
      expect(queryExcept).toBe(
        "INSERT INTO `my-table` (* EXCEPT (temp_field)) FORMAT JSONEachRow",
      );
    });
  });
});
