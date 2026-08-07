import { compileRowBinaryWithNamesAndTypes } from "@clickhouse/rowbinary/readers/rowBinaryWithNamesAndTypes";
import { Cursor } from "@clickhouse/rowbinary/readers/core";
import { compileRowRenderers } from "../tsv-serialize.js";
import { appendLog } from "../log.js";
import {
  type BackendOptions,
  buildClickHouseSettings,
  createSessionClient,
  settleExpectedError,
} from "./shared.js";

/**
 * RowBinary backend: instead of letting ClickHouse format the result text, ask
 * for `RowBinaryWithNamesAndTypes`, decode it with `@clickhouse/rowbinary`'s
 * dynamic header→reader path, and re-render the rows as `TabSeparated` so the
 * upstream `clickhouse-test` diff against the static `.reference` still applies.
 * That round-trip is what actually exercises (and proves) the parser end-to-end
 * on real upstream queries.
 *
 * Only statements that return a result set AND have no explicit `FORMAT` clause
 * take the decode path; DDL / INSERT / `SET` / explicit-`FORMAT` statements fall
 * through to plain passthrough (ClickHouse formats them, exactly as the default
 * backend does). A decode or render error is NOT swallowed — it surfaces as a
 * failed statement so the test stays off the rowbinary allowlist rather than
 * silently passing through an unexercised path. Error-hinted statements
 * (`-- { serverError ... }`) are reconciled with {@link settleExpectedError},
 * exactly like the passthrough backend.
 */
export async function executeWithRowBinary(
  opts: BackendOptions,
): Promise<void> {
  const { args, statements, logPath } = opts;
  const client = createSessionClient(args, logPath);
  const clickhouse_settings = buildClickHouseSettings(args);

  try {
    for (const stmt of statements) {
      const decode = shouldDecode(stmt.sql);
      appendLog(
        logPath,
        (decode ? "rowbinary_query=" : "passthrough_query=") + stmt.sql,
      );
      let execError: unknown = null;
      try {
        if (decode) {
          await runDecoded(stmt.sql);
        } else {
          const result = await client.exec({
            query: stmt.sql,
            clickhouse_settings,
          });
          for await (const chunk of result.stream) {
            process.stdout.write(chunk);
          }
        }
      } catch (err) {
        execError = err;
      }
      settleExpectedError(stmt, execError, logPath);
    }
  } finally {
    await client.close();
  }

  /** Issue `q` as RowBinaryWithNamesAndTypes, decode, render TSV to stdout. */
  async function runDecoded(q: string): Promise<void> {
    const result = await client.exec({
      query: `${q}\nFORMAT RowBinaryWithNamesAndTypes`,
      clickhouse_settings,
    });
    // `result.stream` yields Uint8Array chunks; Buffer.concat accepts them and
    // returns a Buffer (what Cursor needs), so no per-chunk cast is required.
    const chunks: Uint8Array[] = [];
    for await (const chunk of result.stream) {
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);
    // A statement that produced no result set at all (e.g. a misclassified
    // no-output statement) yields zero bytes — nothing to decode or print.
    if (buf.length === 0) return;

    const cursor = new Cursor(buf);
    const { types, columnReaders } = compileRowBinaryWithNamesAndTypes(cursor);
    const renderers = compileRowRenderers(types);
    // Decode POSITIONALLY, column reader by column reader, rather than via the
    // name-keyed row objects from `readRows`: a Record collapses duplicate
    // column names (`SELECT 1 AS x, 2 AS x`) and reorders integer-like names
    // (`SELECT 1 AS \`0\``), either of which would misalign cells against the
    // header. The cursor sits at the first row after the header; the response is
    // fully buffered, so we read complete rows until the bytes are exhausted.
    const n = columnReaders.length;
    const lines: string[] = [];
    while (cursor.pos < buf.length) {
      const cells = new Array<string>(n);
      for (let i = 0; i < n; i++) {
        cells[i] = renderers[i]!(columnReaders[i]!(cursor));
      }
      lines.push(cells.join("\t"));
    }
    // Join once (a row is terminated by \n, so the block ends with one too)
    // rather than growing a string per row.
    if (lines.length > 0) process.stdout.write(lines.join("\n") + "\n");
  }
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

/** A trailing/explicit `FORMAT <name>` clause (also matches INSERT ... FORMAT). */
function hasExplicitFormat(stmt: string): boolean {
  return /\bFORMAT\s+[A-Za-z0-9_]+/i.test(stmt);
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
