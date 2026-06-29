// Support for upstream `clickhouse-test` error hints.
//
// Many `.sql` tests in ClickHouse/ClickHouse annotate a statement that is
// *expected to fail* with a trailing comment, e.g.:
//
//   SELECT throwIf(1);                 -- { serverError FUNCTION_THROW_IF_VALUE_IS_NON_ZERO }
//   SELECT * FROM does_not_parse(;     -- { clientError SYNTAX_ERROR }
//   SELECT 1 / 0;                      -- { serverError 153, 6 }
//
// The real `clickhouse-client` parses these hints (see upstream
// `src/Client/TestHint.cpp`) and, when the query raises the expected error,
// treats it as a pass and emits no output. Our Node shim must do the same,
// otherwise the propagated `ClickHouseError` aborts the script and the test is
// reported as a failure even though the server behaved exactly as expected.
//
// Upstream rule we mirror: an error hint is only honored when it *trails* the
// statement it refers to — hints in a leading comment are ignored. Because our
// statement splitter cuts on `;`, the trailing comment of statement N ends up
// as the leading comment of statement N+1 (or as a standalone comment-only
// final element). We therefore attach a leading hint to the *previous*
// statement, which reproduces the upstream "trailing comment" semantics.

/** A set of error codes/names a query is expected to fail with. */
export interface ExpectedError {
  /** Human-readable hint, e.g. `serverError SIZES_OF_ARRAYS_DONT_MATCH`. */
  label: string;
  /** Numeric error codes (as strings), matched against `ClickHouseError.code`. */
  codes: Set<string>;
  /** Named error codes, matched against `ClickHouseError.type`. */
  names: Set<string>;
}

/** A single statement to run, with an optional expected-error annotation. */
export interface Statement {
  sql: string;
  expectedError: ExpectedError | null;
}

const ERROR_COMMANDS = new Set(["serverError", "clientError", "error"]);

/**
 * Parse the contents of a single hint comment (the text *including* the comment
 * markers). Returns the expected error if the comment carries a
 * `serverError` / `clientError` / `error` directive, otherwise `null`.
 *
 * We deliberately merge `serverError` and `clientError` codes into one
 * acceptance set: over HTTP every failure surfaces as a server error, so a
 * `clientError` hint (which upstream attributes to the native client's local
 * parsing) is still satisfied when the matching code comes back from the
 * server.
 */
export function parseHintComment(comment: string): ExpectedError | null {
  const open = comment.indexOf("{");
  if (open === -1) return null;
  const close = comment.indexOf("}", open + 1);
  if (close === -1) return null;

  const inner = comment.slice(open + 1, close);
  const tokens = inner.split(/[\s,]+/).filter((t) => t.length > 0);
  const cmdIndex = tokens.findIndex((t) => ERROR_COMMANDS.has(t));
  if (cmdIndex === -1) return null;

  const command = tokens[cmdIndex];
  const codes = new Set<string>();
  const names = new Set<string>();
  // Everything after the command keyword is a comma-separated list of codes,
  // each either a numeric error code or a named one (e.g. SYNTAX_ERROR).
  for (const token of tokens.slice(cmdIndex + 1)) {
    if (/^\d+$/.test(token)) {
      codes.add(token);
    } else {
      names.add(token);
    }
  }
  if (codes.size === 0 && names.size === 0) return null;

  const label = `${command} ${tokens.slice(cmdIndex + 1).join(", ")}`;
  return { label, codes, names };
}

/**
 * Walk the leading run of whitespace and comments of a statement and return the
 * first error hint found, or `null`. Scanning stops at the first non-comment
 * token (where the SQL body begins), so genuine trailing hints — which live in
 * the *next* split element — are not picked up here.
 */
function extractLeadingHint(statement: string): ExpectedError | null {
  let i = 0;
  const n = statement.length;
  while (i < n) {
    const ch = statement.charAt(i);
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "-" && statement.charAt(i + 1) === "-") {
      const newlineIdx = statement.indexOf("\n", i + 2);
      const end = newlineIdx === -1 ? n : newlineIdx;
      const hint = parseHintComment(statement.slice(i, end));
      if (hint) return hint;
      i = end;
      continue;
    }
    if (ch === "/" && statement.charAt(i + 1) === "*") {
      const closeIdx = statement.indexOf("*/", i + 2);
      const end = closeIdx === -1 ? n : closeIdx + 2;
      const hint = parseHintComment(statement.slice(i, end));
      if (hint) return hint;
      i = end;
      continue;
    }
    break; // SQL body starts here
  }
  return null;
}

/** Whether a split element contains any SQL beyond comments/whitespace. */
function hasSqlContent(statement: string): boolean {
  let i = 0;
  const n = statement.length;
  while (i < n) {
    const ch = statement.charAt(i);
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "-" && statement.charAt(i + 1) === "-") {
      const newlineIdx = statement.indexOf("\n", i + 2);
      i = newlineIdx === -1 ? n : newlineIdx;
      continue;
    }
    if (ch === "/" && statement.charAt(i + 1) === "*") {
      const closeIdx = statement.indexOf("*/", i + 2);
      i = closeIdx === -1 ? n : closeIdx + 2;
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Turn the raw output of `splitQueries` into executable statements, attaching
 * each trailing error hint to the statement it annotates. Comment-only
 * elements (e.g. a hint left dangling after the final statement) carry their
 * hint to the preceding statement and are otherwise dropped.
 */
export function buildStatements(rawQueries: string[]): Statement[] {
  const statements: Statement[] = [];
  for (const raw of rawQueries) {
    const hint = extractLeadingHint(raw);
    const previous = statements[statements.length - 1];
    if (hint && previous !== undefined) {
      // The trailing hint of the previous statement (upstream semantics).
      previous.expectedError = hint;
    }
    // A leading hint with no preceding statement is ignored, matching upstream.
    if (hasSqlContent(raw)) {
      statements.push({ sql: raw, expectedError: null });
    }
  }
  return statements;
}

/** Whether an error raised by the client matches the expected-error hint. */
export function errorMatchesExpectation(
  err: unknown,
  expected: ExpectedError,
): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  const type = (err as { type?: unknown }).type;
  if (typeof code === "string" && expected.codes.has(code)) return true;
  if (typeof code === "number" && expected.codes.has(String(code))) return true;
  if (typeof type === "string" && expected.names.has(type)) return true;
  return false;
}
