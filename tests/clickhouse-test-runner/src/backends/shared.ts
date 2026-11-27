import { randomUUID } from "node:crypto";
import {
  ClickHouseError,
  ClickHouseLogLevel,
  createClient,
  type ClickHouseClient,
  type ClickHouseSettings,
  type DataFormat,
} from "@clickhouse/client";
import {
  ClickHouseError as NativeClickHouseError,
  createClient as createNativeClient,
} from "@clickhouse/client-native";
import { resolveHttpPort, type ParsedArgs } from "../args.js";
import {
  leadingKeyword,
  skipQuoted,
  skipWhitespaceAndComments,
  stripComments,
  wordEnd,
} from "../lexer.js";
import { appendLog } from "../log.js";
import type { Statement } from "../split.js";
import {
  errorName,
  expectsError,
  hintLabel,
  hintMatches,
} from "../test-hint.js";

export interface BackendOptions {
  args: ParsedArgs;
  statements: Statement[];
  logPath: string;
}

const SYNTAX_ERROR = 62;
/** The server adds this to an error that it finds while it analyzes a parsed query. */
const ANALYSIS_ERROR = ": In scope ";

/** A result that does not match the test hint, or a statement that the shim cannot run. */
export class ShimError extends Error {}

/**
 * How a session reaches the server: `http` with @clickhouse/client and a
 * `session_id`, or `native` with @clickhouse/client-native, where the one TCP
 * connection is the session.
 */
export type Transport = "http" | "native";

type NativeClickHouseClient = ReturnType<typeof createNativeClient>;

/**
 * The state of one shim invocation: one server session, as clickhouse-client
 * has. `SET`, `USE` and temporary tables last for the whole invocation.
 */
export class Session {
  readonly sessionId = `clickhouse-js-test-runner-${randomUUID()}`;
  private client: ClickHouseClient | NativeClickHouseClient;
  private readonly transport: Transport;
  /**
   * The command-line settings that go with each request, as clickhouse-client
   * sends them. A `SET` of the same setting in the test removes it from here,
   * because the session then holds the value.
   */
  private readonly settings: Map<string, string>;
  private readonly paramRef: RegExp | null;
  /** The `session_timezone` of the session, from the command line or a `SET`. */
  timeZone: string | null;
  private readonly args: ParsedArgs;
  private readonly logPath: string;

  constructor(
    args: ParsedArgs,
    logPath: string,
    transport: Transport = "http",
  ) {
    this.args = args;
    this.logPath = logPath;
    this.transport = transport;
    appendLog(logPath, "session_id=" + this.sessionId);
    this.settings = commandLineSettings(args);
    this.timeZone = this.settings.get("session_timezone") ?? null;
    this.client = this.makeClient(args.database);
    const names = Object.keys(args.params).map(escapeRegExp);
    this.paramRef =
      names.length > 0
        ? new RegExp("\\{\\s*(?:" + names.join("|") + ")\\s*:")
        : null;
  }

  private makeClient(
    database: string,
  ): ClickHouseClient | NativeClickHouseClient {
    if (this.transport === "native") {
      return createNativeClient({
        url: `${this.args.secure ? "tcps" : "tcp"}://${this.args.host}:${this.args.port}`,
        username: this.args.user,
        password: this.args.password,
        database,
        // The TCP connection is the session: keep one for the whole script.
        max_open_connections: 1,
        log: { level: ClickHouseLogLevel.OFF },
      });
    }
    const proto = this.args.secure ? "https" : "http";
    const port = resolveHttpPort(this.args.port, this.args.secure);
    return createClient({
      url: `${proto}://${this.args.host}:${port}`,
      username: this.args.user,
      password: this.args.password,
      database,
      session_id: this.sessionId,
      // The client logs request errors to stderr by default. The shim reports
      // failures itself, and tests/clickhouse-test fails a test that writes to
      // stderr, so keep the client itself silent.
      log: { level: ClickHouseLogLevel.OFF },
    });
  }

  /** The HTTP client of the session, for the backends that decode HTTP results. */
  get current(): ClickHouseClient {
    if (this.transport !== "http") {
      throw new ShimError("this backend needs the HTTP transport");
    }
    return this.client as ClickHouseClient;
  }

  /** The native client of the session, or null over HTTP. */
  get native(): NativeClickHouseClient | null {
    return this.transport === "native"
      ? (this.client as NativeClickHouseClient)
      : null;
  }

  /**
   * The settings to send with a request, with `default_format` of the backend.
   * The server reads the format of a statement without a FORMAT clause from
   * `default_format`, so the query text stays as the test wrote it.
   */
  requestSettings(
    defaultFormat: "TabSeparated" | "RowBinaryWithNamesAndTypes",
  ): ClickHouseSettings {
    return {
      ...Object.fromEntries(this.settings),
      // The DataFormat type of the client does not list the RowBinary formats,
      // but the server accepts every format name here.
      default_format: defaultFormat as DataFormat,
    };
  }

  /**
   * {@link requestSettings} as plain values, for the native client: its
   * settings type is its own copy of the common one.
   */
  plainRequestSettings(defaultFormat: "TabSeparated"): Record<string, string> {
    return {
      ...Object.fromEntries(this.settings),
      default_format: defaultFormat,
    };
  }

  /**
   * The command-line settings without `default_format`, for `query()`, which
   * sets the format of the request itself.
   */
  querySettings(): ClickHouseSettings {
    return Object.fromEntries(this.settings);
  }

  /**
   * The query parameters for a statement. A user gives them to the statements
   * that use them, as clickhouse-client does with `--param_<name>`.
   */
  queryParams(sql: string): Record<string, string> | undefined {
    if (this.paramRef === null || !this.paramRef.test(sql)) return undefined;
    return { ...this.args.params };
  }

  /**
   * Run the statements in order, as clickhouse-client does. Stop at the first
   * statement whose result does not match its test hint.
   *
   * `execute` sends one statement. It resolves when the server accepted it
   * (the HTTP status is known) and returns a function that writes the result.
   * Thus the echo comes before the result, and an error before the echo
   * suppresses it as in clickhouse-client.
   */
  async run(
    statements: Statement[],
    execute: (sql: string) => Promise<() => Promise<void>>,
  ): Promise<void> {
    try {
      for (const st of statements) {
        await this.runOne(st, execute);
      }
    } finally {
      await this.client.close();
    }
  }

  private async runOne(
    st: Statement,
    execute: (sql: string) => Promise<() => Promise<void>>,
  ): Promise<void> {
    if (st.hint.parseError !== null) {
      this.echo(st);
      throw new ShimError(st.hint.parseError);
    }
    appendLog(this.logPath, "executing_query=" + st.sql);
    let err: unknown = null;
    // The server accepted the statement: an error after this point (while the
    // result is read or written) comes after the echo, which is then done.
    let accepted = false;
    try {
      const write = await execute(st.sql);
      accepted = true;
      this.echo(st);
      await write();
    } catch (e) {
      err = e;
      // clickhouse-client parses a statement before it echoes it, so it does
      // not echo a statement with a syntax error. A SYNTAX_ERROR from the
      // analysis of the query ("In scope ...") comes after the parse: that
      // statement is echoed.
      const code = errorCode(e);
      if (
        !accepted &&
        (code !== SYNTAX_ERROR ||
          (e instanceof Error && e.message.includes(ANALYSIS_ERROR)))
      ) {
        this.echo(st);
      }
    }
    this.settle(st, err);
    if (err === null) await this.afterSuccess(st.sql);
  }

  private echo(st: Statement): void {
    if (st.echo) process.stdout.write(st.full + "\n");
  }

  /** Compare the outcome of a statement with its test hint. Throws on a mismatch. */
  private settle(st: Statement, err: unknown): void {
    const hint = st.hint;
    if (!expectsError(hint)) {
      if (err !== null) {
        appendLog(this.logPath, "error=" + messageOf(err));
        throw err;
      }
      return;
    }
    if (err === null) {
      throw new ShimError(
        `Expected error (${hintLabel(hint)}) but the query succeeded: ${st.full}`,
      );
    }
    const code = errorCode(err);
    if (code === undefined || !hintMatches(hint, code)) {
      throw new ShimError(
        `Expected error (${hintLabel(hint)}) but got a different error: ${messageOf(err)}`,
      );
    }
    // clickhouse-client compares only the code. The shim also checks the
    // `type` that @clickhouse/client gives, because a user reads it: a wrong
    // type is a client bug, and the test must show it.
    const type = (err as ClickHouseError).type;
    const name = errorName(code);
    if (type !== undefined && name !== undefined && type !== name) {
      throw new ShimError(
        `Expected error (${hintLabel(hint)}): the code matches, but ClickHouseError.type is ${type}, not ${name}: ${messageOf(err)}`,
      );
    }
    appendLog(this.logPath, "expected_error_matched=" + hintLabel(hint));
  }

  /** Update the session state after a `USE` or a `SET`. */
  private async afterSuccess(sql: string): Promise<void> {
    const keyword = leadingKeyword(sql);
    if (keyword === "USE") {
      const db = parseUseDatabase(sql, this.args.params);
      if (db === null) {
        throw new ShimError(`cannot read the database name of ${sql}`);
      }
      // Over HTTP, the client sends its `database` with each request, and that
      // database replaces the current database of the session. A user makes a
      // client with the new database; the session stays the same. Over the
      // native protocol, the server already switched the database of the
      // connection, and a new client would open a new session.
      if (this.transport === "http") {
        await this.client.close();
        this.client = this.makeClient(db);
      }
      appendLog(this.logPath, "database=" + db);
    } else if (keyword === "SET") {
      for (const [name, value] of Object.entries(parseSetAssignments(sql))) {
        this.settings.delete(name);
        if (name === "session_timezone") this.timeZone = value;
      }
    }
  }
}

/** The server settings of the command line, as clickhouse-client sends them. */
function commandLineSettings(args: ParsedArgs): Map<string, string> {
  const settings = new Map<string, string>();
  if (args.logComment !== null && args.logComment.length > 0) {
    settings.set("log_comment", args.logComment);
  }
  if (args.sendLogsLevel !== null && args.sendLogsLevel.length > 0) {
    settings.set("send_logs_level", args.sendLogsLevel);
  }
  if (args.maxInsertThreads !== null && args.maxInsertThreads.length > 0) {
    settings.set("max_insert_threads", args.maxInsertThreads);
  }
  for (const [k, v] of Object.entries(args.serverSettings)) {
    settings.set(k, v);
  }
  return settings;
}

/** The ClickHouse error code of an error of the client, or undefined. */
export function errorCode(err: unknown): number | undefined {
  // @clickhouse/client-native builds its own copy of the common sources, so
  // its ClickHouseError is a different class.
  if (err instanceof ClickHouseError || err instanceof NativeClickHouseError) {
    const n = Number(err.code);
    return Number.isInteger(n) ? n : undefined;
  }
  return undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unquoteIdentifier(text: string): string {
  const q = text.charAt(0);
  const body = text.slice(1, -1);
  return body
    .split(q + q)
    .join(q)
    .replace(/\\(.)/g, "$1");
}

/**
 * The database name of a `USE` statement. A `{name:Identifier}` query
 * parameter is replaced by its value.
 */
export function parseUseDatabase(
  sql: string,
  params: Record<string, string>,
): string | null {
  const text = stripComments(sql);
  let i = skipWhitespaceAndComments(text, 0);
  i = wordEnd(text, i);
  let rest = text.slice(i).trim();
  if (rest.endsWith(";")) rest = rest.slice(0, -1).trim();
  const m = /^DATABASE\s+(.*)$/is.exec(rest);
  if (m) rest = m[1]!;
  if (rest.length === 0) return null;
  if (rest.charAt(0) === "`" || rest.charAt(0) === '"') {
    if (skipQuoted(rest, 0) !== rest.length) return null;
    return unquoteIdentifier(rest);
  }
  if (rest.charAt(0) === "{") {
    const inner = rest.replace(/^\{|\}$/g, "");
    const colon = inner.indexOf(":");
    if (colon < 0) return null;
    return params[inner.slice(0, colon).trim()] ?? null;
  }
  if (wordEnd(rest, 0) !== rest.length) return null;
  return rest;
}

/**
 * The settings that a `SET a = 1, b = 'x'` statement assigns, with their values
 * (string values without quotes).
 */
export function parseSetAssignments(sql: string): Record<string, string> {
  const text = stripComments(sql);
  const i = wordEnd(text, skipWhitespaceAndComments(text, 0));
  let body = text.slice(i).trim();
  if (body.endsWith(";")) body = body.slice(0, -1);
  const out: Record<string, string> = {};
  const add = (part: string): void => {
    const eq = part.indexOf("=");
    if (eq < 0) return;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    out[part.slice(0, eq).trim()] = value;
  };
  let depth = 0;
  let start = 0;
  let j = 0;
  while (j < body.length) {
    const c = body.charAt(j);
    if (c === "'" || c === '"' || c === "`") {
      j = skipQuoted(body, j);
      continue;
    }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      add(body.slice(start, j));
      start = j + 1;
    }
    j++;
  }
  add(body.slice(start));
  return out;
}
