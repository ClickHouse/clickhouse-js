// Test hints, as clickhouse-client parses them (see src/Client/TestHint.cpp of
// ClickHouse/ClickHouse):
//
//   SELECT throwIf(1); -- { serverError FUNCTION_THROW_IF_VALUE_IS_NON_ZERO }
//   SELECT 1 / 0;      -- { serverError 153, 6 }
//   -- { echoOn }
//
// An error hint counts only when it is not in a leading comment of the
// statement. An echo hint counts in any comment. Ported from the harness of
// clickhouse-connect (clickhouse_test_runner/hint.py).

import { ERROR_CODES } from "./error-codes.js";
import {
  heredocEnd,
  isSpace,
  skipBlockComment,
  skipLineComment,
  skipQuoted,
  startsLineComment,
} from "./lexer.js";

export interface TestHint {
  /** Codes of `serverError` (or `error`). */
  serverErrors: number[];
  /** Codes of `clientError` (or `error`). */
  clientErrors: number[];
  /** Set by `echo` or `echoOn` (true) and `echoOff` (false). */
  echo: boolean | null;
  /** Set when a hint is malformed or names an unknown error. */
  parseError: string | null;
}

const ERROR_NAMES: ReadonlyMap<number, string> = new Map(
  [...ERROR_CODES].map(([name, code]) => [code, name]),
);

/** The name of an error code, or undefined when the code is not known. */
export function errorName(code: number): string | undefined {
  return ERROR_NAMES.get(code);
}

export function emptyHint(): TestHint {
  return { serverErrors: [], clientErrors: [], echo: null, parseError: null };
}

export function expectsError(h: TestHint): boolean {
  return h.serverErrors.length > 0 || h.clientErrors.length > 0;
}

/**
 * Whether the error code satisfies the hint. Over HTTP the server finds every
 * error, also the syntax errors that clickhouse-client finds locally, so a
 * server error can satisfy a `clientError` hint too.
 */
export function hintMatches(h: TestHint, code: number): boolean {
  return h.serverErrors.includes(code) || h.clientErrors.includes(code);
}

export function hintLabel(h: TestHint): string {
  const codes = (values: number[]): string =>
    values.map((c) => errorName(c) ?? String(c)).join(", ");
  if (h.serverErrors.length > 0 && h.clientErrors.length > 0) {
    return "error " + codes(h.serverErrors);
  }
  if (h.serverErrors.length > 0) return "serverError " + codes(h.serverErrors);
  return "clientError " + codes(h.clientErrors);
}

function tokenize(body: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = body.length;
  while (i < n) {
    const c = body.charAt(i);
    if (isSpace(c)) {
      i++;
    } else if (c === ",") {
      out.push(",");
      i++;
    } else {
      let j = i;
      while (j < n && !isSpace(body.charAt(j)) && body.charAt(j) !== ",") j++;
      out.push(body.slice(i, j));
      i = j;
    }
  }
  return out;
}

function parseHintBody(h: TestHint, body: string, leading: boolean): void {
  const tokens = tokenize(body);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok === "echo" || tok === "echoOn") {
      h.echo = true;
    } else if (tok === "echoOff") {
      h.echo = false;
    } else if (tok === "retry") {
      // `retry N until|while serverError X` is used by a few tests that wait
      // for a background process. It is not supported.
      h.parseError = 'the "retry" test hint is not supported';
      return;
    } else if (
      tok === "serverError" ||
      tok === "clientError" ||
      tok === "error"
    ) {
      if (leading) continue;
      const values: number[] = [];
      for (const t of tokens.slice(i + 1)) {
        if (t === ",") continue;
        if (/^\d+$/.test(t)) {
          values.push(Number(t));
          continue;
        }
        const code = ERROR_CODES.get(t);
        if (code === undefined) {
          h.parseError = `unknown error name '${t}' in test hint`;
          return;
        }
        values.push(code);
      }
      if (tok === "serverError") {
        h.serverErrors = values;
      } else if (tok === "clientError") {
        h.clientErrors = values;
      } else {
        h.serverErrors = values;
        h.clientErrors = [...values];
      }
      return;
    }
  }
}

/** The characters that can start a comment, a quoted text or a heredoc. */
const INTERESTING = /[-#/'"`$]/g;

/** Parse the test hints in the comments of a statement (its `full` text). */
export function parseTestHint(full: string): TestHint {
  const h = emptyHint();
  let leading = true;
  let i = 0;
  const n = full.length;
  while (i < n) {
    const c = full.charAt(i);
    if (isSpace(c)) {
      i++;
      continue;
    }
    let end: number;
    if (startsLineComment(full, i)) {
      end = skipLineComment(full, i);
    } else if (full.startsWith("/*", i)) {
      end = skipBlockComment(full, i);
    } else if (c === "'" || c === '"' || c === "`") {
      leading = false;
      i = skipQuoted(full, i);
      continue;
    } else if (c === "$") {
      leading = false;
      const e = heredocEnd(full, i);
      i = e > 0 ? e : i + 1;
      continue;
    } else {
      leading = false;
      INTERESTING.lastIndex = i + 1;
      const m = INTERESTING.exec(full);
      i = m ? m.index : n;
      continue;
    }
    const comment = full.slice(i, end);
    const open = comment.indexOf("{");
    if (open >= 0) {
      const close = comment.indexOf("}", open);
      if (close >= 0) parseHintBody(h, comment.slice(open + 1, close), leading);
    }
    i = end;
  }
  return h;
}
