import { compileJsonRowRenderers } from "../json-serialize.js";
import { appendLog } from "../log.js";
import { shouldDecode } from "./rowbinary.js";
import { type BackendOptions, Session } from "./shared.js";

/** The format that the shim asks `query()` for. */
const FORMAT = "JSONCompactEachRowWithNamesAndTypes";

/**
 * JSON backend: read each result through the public read API of
 * `@clickhouse/client`, as an application does. A statement that returns rows
 * and has no FORMAT clause goes through `client.query({ format:
 * "JSONCompactEachRowWithNamesAndTypes" })`, and `ResultSet.json()` decodes it
 * (the client splits the stream into rows, parses each row, and finds an
 * error in the stream). The shim then writes the decoded values as
 * TabSeparated, from the column types of the result. A value that the client
 * changed (for example a large integer that `JSON.parse` rounded) makes the
 * test fail. Other statements run as with the passthrough backend.
 */
export async function executeWithJson(opts: BackendOptions): Promise<void> {
  const { logPath } = opts;
  const session = new Session(opts.args, logPath);
  await session.run(opts.statements, async (sql) => {
    const decode = shouldDecode(sql);
    appendLog(logPath, decode ? "decode=json" : "decode=passthrough");
    if (!decode) {
      const result = await session.current.exec({
        query: sql,
        clickhouse_settings: session.requestSettings("TabSeparated"),
        query_params: session.queryParams(sql),
      });
      return async () => {
        for await (const chunk of result.stream) {
          process.stdout.write(chunk);
        }
      };
    }
    const rs = await session.current.query({
      query: sql,
      format: FORMAT,
      clickhouse_settings: session.querySettings(),
      query_params: session.queryParams(sql),
    });
    return async () => {
      const rows = await rs.json<unknown[]>();
      writeRows(rows);
    };
  });
}

/** `rows` has the names row, the types row, then the data rows. */
function writeRows(rows: unknown[][]): void {
  if (rows.length < 2) return;
  const types = rows[1] as string[];
  const renderers = compileJsonRowRenderers(types);
  const lines: string[] = [];
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r]!;
    lines.push(renderers.map((render, i) => render(row[i])).join("\t"));
  }
  if (lines.length > 0) process.stdout.write(lines.join("\n") + "\n");
}
