import { compileRowBinaryWithNamesAndTypes } from "@clickhouse/rowbinary/readers/rowBinaryWithNamesAndTypes";
import { Cursor } from "@clickhouse/rowbinary/readers/core";
import { compileRowRenderers, setDefaultTimeZone } from "../tsv-serialize.js";
import { appendLog } from "../log.js";
import { type BackendOptions, Session } from "./shared.js";

/**
 * RowBinary backend: instead of letting ClickHouse write the result text, ask
 * for `RowBinaryWithNamesAndTypes`, decode it with `@clickhouse/rowbinary`'s
 * dynamic header-to-reader path, and write the rows as `TabSeparated`, so that
 * the `.reference` diff of tests/clickhouse-test still applies. Thus each value
 * goes through the decoder.
 *
 * Only statements that return a result set and have no `FORMAT` clause take
 * the decode path. The format comes from the `default_format` setting, so the
 * query text is sent as it is. Other statements run as with the passthrough
 * backend. A decode or write error fails the statement.
 */
export async function executeWithRowBinary(
  opts: BackendOptions,
): Promise<void> {
  const { logPath } = opts;
  const session = new Session(opts.args, logPath);
  await session.run(opts.statements, async (sql) => {
    const decode = shouldDecode(sql);
    appendLog(logPath, decode ? "decode=rowbinary" : "decode=passthrough");
    const result = await session.current.exec({
      query: sql,
      clickhouse_settings: session.requestSettings(
        decode ? "RowBinaryWithNamesAndTypes" : "TabSeparated",
      ),
      query_params: session.queryParams(sql),
    });
    if (!decode) {
      return async () => {
        for await (const chunk of result.stream) {
          process.stdout.write(chunk);
        }
      };
    }
    return async () => {
      // `result.stream` yields Uint8Array chunks; Buffer.concat accepts them
      // and returns a Buffer (what Cursor needs).
      const chunks: Uint8Array[] = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk);
      }
      setDefaultTimeZone(session.timeZone);
      writeDecoded(Buffer.concat(chunks));
    };
  });
}

/** Decode a RowBinaryWithNamesAndTypes result and write it as TSV to stdout. */
function writeDecoded(buf: Buffer): void {
  // A statement that produced no result set yields zero bytes.
  if (buf.length === 0) return;
  const cursor = new Cursor(buf);
  const { types, columnReaders } = compileRowBinaryWithNamesAndTypes(cursor);
  const renderers = compileRowRenderers(types);
  // Decode positionally, column reader by column reader, not via the
  // name-keyed row objects of `readRows`: a Record collapses duplicate column
  // names (`SELECT 1 AS x, 2 AS x`) and reorders integer-like names, and the
  // cells would then not match the header. The response is fully buffered, so
  // read complete rows until the bytes are exhausted.
  const n = columnReaders.length;
  const lines: string[] = [];
  while (cursor.pos < buf.length) {
    const cells = new Array<string>(n);
    for (let i = 0; i < n; i++) {
      cells[i] = renderers[i]!(columnReaders[i]!(cursor));
    }
    lines.push(cells.join("\t"));
  }
  if (lines.length > 0) process.stdout.write(lines.join("\n") + "\n");
}

/** Statements that return a result set whose default text format is TabSeparated. */
const RESULT_KEYWORDS = new Set([
  "SELECT",
  "WITH",
  "SHOW",
  "DESC",
  "DESCRIBE",
  "EXISTS",
  "EXPLAIN",
  "VALUES",
]);

/**
 * True when `stmt` should go through the RowBinary decode path: it returns rows
 * and carries no explicit `FORMAT` clause (which would fix its own output text,
 * and whose `.reference` is in that other format).
 */
export function shouldDecode(stmt: string): boolean {
  if (hasExplicitFormat(stmt)) return false;
  const kw = leadingKeyword(stmt);
  return kw !== null && RESULT_KEYWORDS.has(kw);
}

/**
 * A trailing/explicit `FORMAT <name>` clause (also matches INSERT ... FORMAT).
 * The name can be quoted, as in FORMAT `Null`.
 */
function hasExplicitFormat(stmt: string): boolean {
  return /\bFORMAT\s+(`[^`]+`|"[^"]+"|[A-Za-z0-9_]+)/i.test(stmt);
}

/**
 * The leading SQL keyword, upper-cased — skipping leading line/block comments,
 * whitespace and an optional opening parenthesis (`(SELECT ...) ...`). Returns
 * null if no leading word can be found.
 */
function leadingKeyword(stmt: string): string | null {
  let s = stmt;
  // Strip leading comments and whitespace, possibly several in a row.
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, "");
    s = s.replace(/^--[^\n]*\n?/, "");
    s = s.replace(/^\/\*[\s\S]*?\*\//, "");
    if (s === before) break;
  }
  s = s.replace(/^\(+\s*/, "");
  const m = /^([A-Za-z_]+)/.exec(s);
  return m ? m[1]!.toUpperCase() : null;
}
