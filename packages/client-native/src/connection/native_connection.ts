import crypto from "node:crypto";
import os from "node:os";
import Stream from "node:stream";
import type {
  ClickHouseSummary,
  ConnBaseQueryParams,
  ConnCommandParams,
  ConnCommandResult,
  ConnExecParams,
  ConnExecResult,
  ConnInsertParams,
  ConnInsertResult,
  ConnPingParams,
  ConnPingResult,
  ConnQueryResult,
  Connection,
  ConnectionParams,
  DataFormat,
  ResponseHeaders,
} from "../common/index";
import {
  ClickHouseError,
  ClickHouseLogLevel,
  formatQueryParams,
} from "../common/index";
import type { OutputSettings } from "../formats";
import {
  DefaultOutputSettings,
  OutputEncoder,
  OutputSettingNames,
  SupportedNativeFormats,
  applyOutputSettings,
  readQueryClauses,
} from "../formats";
import { encodeText } from "../protocol/columns";
import type { ResultChunk } from "../result_chunk";
import type { DateTimeOutputFormat } from "../protocol/text";
import type {
  Block,
  ClientIdentity,
  QuerySetting,
  ServerException,
  ServerPacket,
} from "../protocol/packets";
import {
  REVISION,
  encodeDataPacket,
  encodeEmptyBlock,
  encodePing,
  encodeQuery,
} from "../protocol/packets";
import packageVersion from "../version";
import {
  ServerParseNeeded,
  encodeBlock,
  stringifyJSON,
} from "../protocol/encode";
import type { ColumnType } from "../protocol/types";
import { quoteIdentifier } from "../protocol/types";
import type { NativeCompressionMethod } from "../compression/frames";
import {
  CLIENT_CLOSED,
  NativeConnectionPool,
  USER_ABORTED,
} from "./connection_pool";
import { exceptionText, toClickHouseError } from "./errors";
import type {
  InsertLayout,
  InsertSession,
  InsertSettings,
  RowContext,
} from "./insert_helpers";
import {
  DefaultInsertSettings,
  INSERT_BLOCK_ROWS,
  InsertSettingNames,
  NO_SUCH_COLUMN_IN_TABLE,
  applyInsertSettings,
  columnPositions,
  columnsWithDefaults,
  encodeInsertRows,
  needsServerDefaults,
  needsTextParser,
  parseInsertTarget,
  readInlineQuery,
  rowKeys,
  startsWithInsert,
  unwrapJSONObjectEachRowBatch,
  withoutToken,
} from "./insert_helpers";
import type {
  NativeSocket,
  NativeTLSOptions,
  PacketHandler,
} from "./native_socket";
import { ProgressTracker } from "./progress_tracker";
import { getArraySource } from "../utils/encoder";

export { columnsWithDefaults };

export interface NativeConnectionParams extends ConnectionParams {
  tls: NativeTLSOptions | undefined;
  /** The compression of the data blocks, or `undefined` for none. */
  compression_method: NativeCompressionMethod | undefined;
  /** Optional outgoing compression level (for `zstd`). */
  compression_level?: number;
  /** How long to wait for a new connection and its handshake, in ms. */
  connect_timeout: number;
}

/** Settings that only the HTTP interface uses, or that the client sets
 *  itself. The client does not send them over the native protocol. */
const SKIPPED_SETTINGS = new Set([
  "default_format",
  "enable_http_compression",
  "send_progress_in_http_headers",
  "http_headers_progress_interval_ms",
  "wait_end_of_query",
  "http_response_buffer_size",
  "http_wait_end_of_query",
  "buffer_size",
]);

/** Settings that make the server send `JSON` and `Dynamic` columns in the
 *  simplest Native forms. Older servers do not know them. */
const NATIVE_FORM_SETTINGS = [
  "output_format_native_write_json_as_string",
  "output_format_native_use_flattened_dynamic_and_json_serialization",
];

/** What the client learns from the server once, with the first request. */
interface ServerSettings {
  output: OutputSettings;
  insert: InsertSettings;
  /** The settings in {@link NATIVE_FORM_SETTINGS} that the client can send. */
  native_form_settings: QuerySetting[];
  /** The user can change settings (not `readonly = 1`). */
  can_change_settings: boolean;
}

/** How to decode the values of one request. */
interface DecodeOptions {
  timezone: string;
  date_time_output_format: DateTimeOutputFormat;
  date_time64_cut_zeros: boolean;
  binary_columns?: { enabled: boolean };
}

function decodeOptions(
  socket: NativeSocket,
  settings: Record<string, unknown>,
  output: OutputSettings,
): DecodeOptions {
  return {
    timezone: queryTimezone(socket, settings),
    date_time_output_format: output.date_time_output_format,
    date_time64_cut_zeros:
      output.date_time_64_output_format_cut_trailing_zeros_align_to_groups_of_thousands,
  };
}

/** The request has options that only the HTTP interface has. */
function assertSupported(params: {
  session_id?: string;
  role?: unknown;
  auth?: unknown;
}): void {
  if (params.session_id !== undefined) {
    throw new Error(
      "session_id is not supported by the native protocol client: each connection is a separate session",
    );
  }
  if (params.role !== undefined) {
    throw new Error("role is not supported by the native protocol client");
  }
  if (params.auth !== undefined) {
    throw new Error(
      "Authentication for one request is not supported by the native protocol client",
    );
  }
}

/** The time zone for one query: the session time zone, if the query sets one. */
function queryTimezone(
  socket: NativeSocket,
  settings: Record<string, unknown>,
): string {
  const tz = settings["session_timezone"];
  return typeof tz === "string" && tz !== "" ? tz : socket.server.timezone;
}

/** Server errors that come from the load of the server at the moment, not
 *  from the user: a later request can read the settings. */
const TRANSIENT_ERROR_CODES = new Set(
  [159, 201, 202, 209, 210, 236, 241, 394, 439, 745].map(String),
);

/** Waits for a promise that other requests share, until `signal` aborts.
 *  The abort does not stop the work behind the promise. */
function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error(USER_ABORTED));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** The parameters of one request. The query is a Buffer or Buffer[] when data
 *  in any format follows the SQL (the server parses the data). */
type RequestParams = Omit<ConnBaseQueryParams, "query"> & {
  query: string | Buffer | Buffer[];
};

/** Refresh cached `system.settings` per server identity after 5 minutes. */
const SERVER_SETTINGS_TTL_MS = 5 * 60_000;
const MAX_SERVER_SETTINGS_ENTRIES = 64;

interface CachedServerSettings {
  promise: Promise<ServerSettings>;
  expiresAt: number;
}

export class NativeConnection implements Connection<Stream.Readable> {
  private readonly params: NativeConnectionParams;
  private readonly client: ClientIdentity;
  private readonly pool: NativeConnectionPool;
  private readonly serverSettings = new Map<string, CachedServerSettings>();

  private get closed(): boolean {
    return this.pool.closed;
  }

  private withShutdown(signal: AbortSignal | undefined): AbortSignal {
    return this.pool.withShutdown(signal);
  }

  constructor(params: NativeConnectionParams) {
    this.params = params;
    if (params.auth.type !== "Credentials") {
      throw new Error(
        "The native protocol client supports only user name and password authentication",
      );
    }
    const [major, minor, patch] = packageVersion.split(".").map(Number);
    const name = `clickhouse-js-native/${packageVersion}`;
    this.client = {
      name: params.application_id ? `${params.application_id} ${name}` : name,
      version_major: major ?? 0,
      version_minor: minor ?? 0,
      version_patch: patch ?? 0,
      os_user: safeUserName(),
      hostname: os.hostname(),
    };
    this.pool = new NativeConnectionPool(params, this.client);
  }

  private acquire(signal: AbortSignal | undefined): Promise<NativeSocket> {
    return this.pool.acquire(signal);
  }

  private release(socket: NativeSocket): void {
    this.pool.release(socket);
  }

  private discard(socket: NativeSocket, err?: Error): void {
    this.pool.discard(socket, err);
  }

  private cancel(socket: NativeSocket, err?: Error): void {
    this.pool.cancel(socket, err);
  }

  async close(): Promise<void> {
    await this.pool.close();
  }

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------

  async query(
    params: ConnBaseQueryParams,
  ): Promise<ConnQueryResult<Stream.Readable>> {
    assertSupported(params);
    const clauses = readQueryClauses(params.query);
    const settings = { ...params.clickhouse_settings, ...clauses.settings };
    const requested = params.clickhouse_settings?.["default_format"] ?? "JSON";
    const format = resolveFormat(
      clauses.format ?? settings.default_format ?? requested,
    );
    if (format.toLowerCase() !== requested.toLowerCase()) {
      throw new Error(
        `The query specifies the ${format} format, but the format option requests ${requested}. ` +
          `Remove the format from the query or use exec() to specify it in SQL.`,
      );
    }
    const { socket, serverSettings } = await this.acquireWithSettings(
      params.abort_signal,
    );
    let encoder: OutputEncoder;
    let decode: DecodeOptions;
    try {
      const output = applyOutputSettings(serverSettings.output, settings);
      encoder = new OutputEncoder(format, output);
      decode = decodeOptions(socket, settings, output);
    } catch (err) {
      this.release(socket);
      throw err;
    }
    return this.runQuery(
      socket,
      params,
      serverSettings,
      encoder,
      format,
      decode,
      {
        parts: true,
        wait_end_of_query: isTruthySetting(
          settings["wait_end_of_query"] ?? settings["http_wait_end_of_query"],
        ),
      },
    );
  }

  private runQuery(
    socket: NativeSocket,
    params: ConnBaseQueryParams,
    serverSettings: ServerSettings,
    encoder: OutputEncoder,
    format: DataFormat,
    decode: DecodeOptions,
    options: {
      /** exec() with ignore_error_response: the error text is the result. */
      ignore_error?: boolean;
      /** The stream gives {@link ResultChunk} parts to the result set of
       *  query(). If not, it gives the bytes of the text (exec()). */
      parts?: boolean;
      /** Buffer until `end_of_stream` so `summary` is complete and mid-query
       *  errors reject `query()`/`exec()` directly (HTTP `wait_end_of_query`). */
      wait_end_of_query?: boolean;
    } = {},
  ): Promise<ConnQueryResult<Stream.Readable>> {
    const binaryColumns = encoder.canWriteBinaryRows
      ? { enabled: true }
      : undefined;
    decode.binary_columns = binaryColumns;
    const ignoreError = options.ignore_error ?? false;
    const parts = options.parts ?? false;
    const waitEnd = options.wait_end_of_query ?? false;
    const query_id = params.query_id ?? crypto.randomUUID();
    const response_headers = this.responseHeaders(socket, query_id, format);
    const progress = new ProgressTracker();
    let rowsBeforeLimit: bigint | undefined;

    return new Promise((resolve, reject) => {
      let resolved = false;
      let finished = false;
      const stream = new Stream.Readable({
        // A part is a block of up to `max_block_size` rows: keep few of them.
        ...(parts ? { objectMode: true, highWaterMark: 2 } : {}),
        read: () => socket.resume(),
        destroy: (err, callback) => {
          encoder.releaseBinaryBuffer();
          if (!finished) {
            // The caller closed the stream before the end of the result.
            finished = true;
            cleanupAbort();
            this.cancel(socket);
          }
          callback(err);
        },
      });
      // The server can fail the query before the caller reads the stream (in
      // the same turn of the event loop as the first rows). The stream keeps
      // the error for its reader. Without this listener, Node.js throws the
      // error as an uncaught exception.
      stream.on("error", () => undefined);
      // Strings with bytes that are not UTF-8 go out as the same bytes.
      const output = (text: string, raw: boolean): string | Buffer =>
        raw ? encodeText(text) : text;
      const push = (text: string) => {
        if (text.length === 0) return;
        const raw = socket.rawBytes;
        const chunk: ResultChunk | string | Buffer = parts
          ? { text: () => output(text, raw) }
          : output(text, raw);
        if (!stream.push(chunk) && resolved) socket.pause();
      };
      // The result set asks for the text or for the rows of a part (see
      // ResultChunk). The encoder runs then, not now.
      const pushPart = (
        text: () => string,
        rows?: (raw: boolean) => { rows: unknown[]; text: string },
        bytes?: number,
      ) => {
        const raw = socket.rawBytes;
        const chunk: ResultChunk = { text: () => output(text(), raw), bytes };
        if (rows !== undefined) {
          chunk.rows = () => {
            const result = rows(raw);
            return { rows: result.rows, text: output(result.text, raw) };
          };
        }
        if (!stream.push(chunk) && resolved) socket.pause();
      };
      const resolveOnce = () => {
        if (resolved) return;
        resolved = true;
        resolve({
          stream,
          query_id,
          response_headers,
          summary: progress.summary(),
        });
      };
      const fail = (err: Error, reusable: boolean, sendCancel = false) => {
        if (finished) return;
        finished = true;
        cleanupAbort();
        if (reusable) this.release(socket);
        else if (sendCancel) this.cancel(socket, err);
        else this.discard(socket, err);
        if (!resolved) {
          resolved = true;
          reject(err);
        } else {
          stream.destroy(err);
        }
      };
      const cleanupAbort = this.onAbort(params.abort_signal, () =>
        fail(new Error(USER_ABORTED), false, true),
      );

      const handler: PacketHandler = {
        packet: (packet: ServerPacket) => {
          switch (packet.type) {
            case "data": {
              const block = packet.block;
              if (block.columns.length === 0) break;
              if (block.rows > 0 && !waitEnd) resolveOnce();
              if (!parts) {
                push(encoder.data(block));
              } else if (encoder.hasDataRows && block.rows > 0) {
                pushPart(
                  () => encoder.data(block),
                  (raw) => {
                    if (binaryColumns !== undefined)
                      binaryColumns.enabled = false;
                    return encoder.dataRows(block, raw);
                  },
                  block.bytes,
                );
              } else {
                pushPart(() => encoder.data(block), undefined, block.bytes);
              }
              break;
            }
            case "totals":
              encoder.totalsBlock(packet.block);
              break;
            case "extremes":
              encoder.extremesBlock(packet.block);
              break;
            case "progress": {
              progress.add(packet.progress);
              const text = encoder.progress(packet.progress);
              // Progress rows are output. Give the caller the stream before
              // they can fill its buffer and pause the socket.
              if (text.length > 0 && !waitEnd) resolveOnce();
              push(text);
              break;
            }
            case "profile_info":
              progress.profile(packet.info);
              if (packet.info.applied_limit)
                rowsBeforeLimit = packet.info.rows_before_limit;
              break;
            case "exception":
              if (ignoreError) {
                // exec() with ignore_error_response: the error text is the result.
                finished = true;
                cleanupAbort();
                resolveOnce();
                push(exceptionText(packet.exception));
                stream.push(null);
                this.release(socket);
              } else {
                fail(toClickHouseError(packet.exception), true);
              }
              break;
            case "end_of_stream": {
              finished = true;
              cleanupAbort();
              resolveOnce();
              const totals = progress.totals();
              const stats = {
                elapsed_ns: totals.elapsed_ns,
                rows_read: totals.read_rows,
                bytes_read: totals.read_bytes,
                rows_before_limit_at_least: rowsBeforeLimit,
              };
              if (parts) pushPart(() => encoder.finish(stats));
              else push(encoder.finish(stats));
              stream.push(null);
              this.release(socket);
              break;
            }
            default:
              break;
          }
        },
        error: (err) => fail(err, false),
      };
      this.send(
        socket,
        handler,
        params,
        serverSettings,
        query_id,
        decode,
      ).catch((err) => fail(err, false));
    });
  }

  async command(params: ConnCommandParams): Promise<ConnCommandResult> {
    return this.runCommand(params, params.ignore_error_response ?? false);
  }

  private async runCommand(
    params: RequestParams,
    ignoreError: boolean,
    onException?: (exception: ServerException) => void,
  ): Promise<ConnCommandResult> {
    assertSupported(params);
    const { socket, serverSettings } = await this.acquireWithSettings(
      params.abort_signal,
    );
    const query_id = params.query_id ?? crypto.randomUUID();
    const summary = await this.execute(
      socket,
      params,
      serverSettings,
      query_id,
      {
        ignore_error: ignoreError,
        release: true,
        on_exception: onException,
      },
    );
    return {
      query_id,
      response_headers: this.responseHeaders(socket, query_id, undefined),
      summary,
    };
  }

  /**
   * Runs a statement and reads all packets until the end. The data blocks
   * are dropped. If the server waits for the data of an INSERT, the client
   * sends no data.
   */
  private execute(
    socket: NativeSocket,
    params: RequestParams,
    serverSettings: ServerSettings,
    query_id: string,
    options: {
      ignore_error: boolean;
      /** Give the socket back to the pool at the end. If false, the caller
       *  keeps the socket (when the request was successful). */
      release: boolean;
      on_block?: (block: Block) => void;
      on_exception?: (exception: ServerException) => void;
      /** Send and receive the data blocks without compression, whatever the
       *  compression of the client. */
      uncompressed?: boolean;
    },
  ): Promise<ClickHouseSummary> {
    const compression = options.uncompressed
      ? undefined
      : this.params.compression_method;
    const compressionLevel = options.uncompressed
      ? undefined
      : this.params.compression_level;
    const progress = new ProgressTracker();
    const isInsert = startsWithInsert(params.query);
    return new Promise((resolve, reject) => {
      let finished = false;
      let tableColumns = false;
      let dataSent = false;
      const done = (
        err: Error | undefined,
        reusable: boolean,
        sendCancel = false,
      ) => {
        if (finished) return;
        finished = true;
        cleanupAbort();
        if (!reusable) {
          if (sendCancel) this.cancel(socket, err);
          else this.discard(socket, err);
        } else if (options.release) {
          this.release(socket);
        } else {
          socket.finish();
          socket.clearTimeout();
        }
        if (err !== undefined) reject(err);
        else resolve(progress.summary());
      };
      const cleanupAbort = this.onAbort(params.abort_signal, () =>
        done(new Error(USER_ABORTED), false, true),
      );
      const handler: PacketHandler = {
        packet: (packet) => {
          switch (packet.type) {
            case "table_columns":
              tableColumns = true;
              break;
            case "data":
              if ((tableColumns || isInsert) && !dataSent) {
                // The server sent the structure of the table and waits for
                // the data of the INSERT: there is no data.
                dataSent = true;
                socket.write(encodeEmptyBlock(compression, compressionLevel));
              } else {
                options.on_block?.(packet.block);
              }
              break;
            case "profile_events":
              progress.profileEvents(packet.block);
              break;
            case "progress":
              progress.add(packet.progress);
              break;
            case "profile_info":
              progress.profile(packet.info);
              break;
            case "exception":
              if (options.ignore_error) {
                options.on_exception?.(packet.exception);
                done(undefined, true);
              } else {
                done(toClickHouseError(packet.exception), true);
              }
              break;
            case "end_of_stream":
              done(undefined, true);
              break;
            default:
              break;
          }
        },
        error: (err) => done(err, false),
      };
      this.send(
        socket,
        handler,
        params,
        serverSettings,
        query_id,
        undefined,
        options.uncompressed,
      ).catch((err) => done(err, false));
    });
  }

  async ping(params: ConnPingParams): Promise<ConnPingResult> {
    try {
      if (params.select) {
        await this.command({ ...params, query: "SELECT 1" });
        return { success: true };
      }
      const socket = await this.acquire(params.abort_signal);
      await new Promise<void>((resolve, reject) => {
        let finished = false;
        const done = (err: Error | undefined) => {
          if (finished) return;
          finished = true;
          cleanupAbort();
          if (err === undefined) this.release(socket);
          else this.discard(socket, err);
          if (err === undefined) resolve();
          else reject(err);
        };
        const cleanupAbort = this.onAbort(params.abort_signal, () =>
          done(new Error(USER_ABORTED)),
        );
        socket.setTimeout(this.params.request_timeout, () =>
          done(new Error("Timeout error.")),
        );
        socket.start(
          {
            packet: (packet) => {
              if (packet.type === "pong") done(undefined);
              else if (packet.type === "exception")
                done(toClickHouseError(packet.exception));
              else if (
                packet.type !== "progress" &&
                packet.type !== "profile_events"
              ) {
                done(
                  new Error(`Unexpected packet ${packet.type} instead of Pong`),
                );
              }
            },
            error: (err) => done(err),
          },
          [encodePing()],
          socket.server.timezone,
        );
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  /**
   * The rows of the JSON formats are JS values (an object-mode stream, see
   * `NodeValuesEncoder`): the client encodes them as Native blocks. The data
   * of the other formats follows the SQL, and the server parses it.
   */
  async insert(
    params: ConnInsertParams<Stream.Readable>,
  ): Promise<ConnInsertResult> {
    assertSupported(params);
    const values = params.values;
    if (typeof values !== "string" && values.readableObjectMode) {
      return this.insertRows(params, values);
    }
    const query =
      typeof values === "string"
        ? [Buffer.from(params.query + "\n"), Buffer.from(values)]
        : await this.readInput(
            values,
            this.withShutdown(params.abort_signal),
            () => readInlineQuery(params.query, values),
          );
    return this.runCommand({ ...params, query }, false);
  }

  private async insertRows(
    params: ConnInsertParams<Stream.Readable>,
    rows: Stream.Readable,
  ): Promise<ConnInsertResult> {
    assertSupported(params);
    const format = readQueryClauses(params.query).format ?? "JSONEachRow";
    const compact = format.startsWith("JSONCompact");
    // The values of the JSONStrings formats are the text of the values.
    const strings = format.includes("Strings");
    const headerRowCount = format.includes("WithNamesAndTypes")
      ? 2
      : format.includes("WithNames")
        ? 1
        : 0;
    const target = parseInsertTarget(params.query);
    const { socket, serverSettings } = await this.acquireWithSettings(
      params.abort_signal,
    );
    const settings = params.clickhouse_settings ?? {};
    const insertSettings = applyInsertSettings(serverSettings.insert, settings);
    const objectNameColumn =
      format === "JSONObjectEachRow"
        ? String(
            settings["format_json_object_each_row_column_for_object_name"] ??
              serverSettings.output
                .format_json_object_each_row_column_for_object_name,
          )
        : "";
    // Narrowing the column list asks the server to evaluate DEFAULT
    // expressions for excluded columns.
    const nameColumns =
      target !== undefined &&
      target.columns === undefined &&
      insertSettings.defaults_for_omitted_fields;
    const inputSignal = this.withShutdown(params.abort_signal);
    const query_id = params.query_id ?? crypto.randomUUID();
    let statementIndex = 0;
    const nextQueryId = (): string => {
      const index = statementIndex++;
      return index === 0 ? query_id : `${query_id}_${index + 1}`;
    };
    const progress = new ProgressTracker();
    const arraySource = getArraySource(rows);
    let arrayOffset = 0;
    const iterator =
      arraySource === undefined ? rows[Symbol.asyncIterator]() : undefined;
    /** The rows before the data in a ...WithNames format. */
    const headerRows: unknown[] = [];
    let headerNames: string[] | undefined;
    /** The columns of the target, known after an unknown column name. */
    let validColumns: Set<string> | undefined;
    let session: InsertSession | undefined;
    /** The column names of the current INSERT, when the client named them. */
    let sessionKeys: Set<string> | undefined;
    let sessionRows = 0;
    let layout: InsertLayout | undefined;
    /** The server must parse all rows (see `needsTextParser`). */
    let textOnly = false;
    let started = false;
    /** The number of INSERT statements that sent rows. */
    let dataStatements = 0;

    const readBatch = async (): Promise<unknown[]> => {
      if (arraySource !== undefined) {
        while (
          headerRows.length < headerRowCount &&
          arrayOffset < arraySource.length &&
          !inputSignal.aborted
        ) {
          const value = arraySource[arrayOffset++];
          if (headerRows.length === 0 && Array.isArray(value)) {
            headerNames = value.map(String);
          }
          headerRows.push(value);
        }
        if (inputSignal.aborted || arrayOffset >= arraySource.length) {
          return [];
        }
        const end = Math.min(
          arrayOffset + INSERT_BLOCK_ROWS,
          arraySource.length,
        );
        const batch = arraySource.slice(arrayOffset, end);
        arrayOffset = end;
        return batch;
      }
      const batch: unknown[] = [];
      while (batch.length < INSERT_BLOCK_ROWS && !inputSignal.aborted) {
        const next = await iterator!.next();
        if (next.done) break;
        if (headerRows.length < headerRowCount) {
          if (headerRows.length === 0 && Array.isArray(next.value)) {
            // The first row of a ...WithNames format has the column names.
            headerNames = next.value.map(String);
          }
          headerRows.push(next.value);
          continue;
        }
        batch.push(next.value);
      }
      return batch;
    };

    // One insert() can need more than one INSERT statement (see below). All
    // statements after the first one that sent rows get their own
    // deduplication token: with the same token, the server drops their rows
    // as duplicates.
    const statement = (query: string): ConnInsertParams<Stream.Readable> => {
      const token = settings["insert_deduplication_token"];
      if (dataStatements === 0 || token === undefined || token === "") {
        return { ...params, query };
      }
      return {
        ...params,
        query,
        clickhouse_settings: {
          ...settings,
          insert_deduplication_token: `${String(token)}_${dataStatements + 1}`,
        },
      };
    };

    const open = async (
      names: string[] | undefined,
    ): Promise<InsertSession> => {
      const query =
        names !== undefined &&
        names.length > 0 &&
        target !== undefined &&
        target.columns === undefined
          ? `INSERT INTO ${target.table} (${names
              .map(quoteIdentifier)
              .join(", ")}) FORMAT ${format}`
          : params.query;
      try {
        return await this.openInsert(
          socket,
          statement(query),
          serverSettings,
          nextQueryId(),
          progress,
          insertSettings,
        );
      } catch (err) {
        if (
          names === undefined ||
          validColumns !== undefined ||
          !insertSettings.skip_unknown_fields ||
          !(err instanceof ClickHouseError) ||
          err.code !== NO_SUCH_COLUMN_IN_TABLE ||
          !socket.usable
        ) {
          throw err;
        }
        // A row has a field that is not a column. The server skips such
        // fields when it parses JSON (`input_format_skip_unknown_fields`).
        // Get the columns of the target with an INSERT that sends no rows,
        // and name only the fields that are columns.
        const probe = await this.openInsert(
          socket,
          { ...params, clickhouse_settings: withoutToken(settings) },
          serverSettings,
          crypto.randomUUID(),
          new ProgressTracker(),
          insertSettings,
        );
        const columns = new Set(probe.columns.map((c) => c.name));
        await probe.close();
        validColumns = columns;
        const known = names.filter((name) => columns.has(name));
        if (known.length === names.length) throw err;
        return open(known);
      }
    };

    const closeSession = async (): Promise<void> => {
      const current = session;
      if (current === undefined) return;
      await current.close();
      if (sessionRows > 0) dataStatements++;
      session = undefined;
      sessionKeys = undefined;
      sessionRows = 0;
    };

    try {
      for (;;) {
        const rawBatch = await this.readInput(rows, inputSignal, readBatch);
        if (rawBatch.length === 0 && started) break;
        started = true;
        let batch = rawBatch;
        let jsonObjectDoc: Record<string, unknown> | undefined;
        if (format === "JSONObjectEachRow" && rawBatch.length > 0) {
          const unwrapped = unwrapJSONObjectEachRowBatch(
            rawBatch,
            objectNameColumn,
          );
          batch = unwrapped.rows;
          jsonObjectDoc = unwrapped.conflictDoc;
        }
        let names: string[] | undefined;
        if (nameColumns && jsonObjectDoc === undefined) {
          names = compact ? headerNames : rowKeys(batch);
          const valid = validColumns;
          if (names !== undefined && valid !== undefined) {
            names = names.filter((name) => valid.has(name));
          }
        }
        if (
          session !== undefined &&
          names !== undefined &&
          sessionKeys !== undefined &&
          !names.every((name) => sessionKeys!.has(name))
        ) {
          // The rows have a column that the current INSERT does not have.
          await closeSession();
        }
        if (session === undefined && !textOnly && jsonObjectDoc === undefined) {
          session = await open(names);
          let positions = columnPositions(session, compact, headerNames);
          if (
            positions !== undefined &&
            target !== undefined &&
            target.columns === undefined &&
            insertSettings.defaults_for_omitted_fields &&
            session.columns.some(
              (column, c) =>
                (positions![c] as number) < 0 &&
                session!.defaults.has(column.name),
            )
          ) {
            // The names row leaves out a column with a DEFAULT expression:
            // name only the columns that the rows have.
            const present = session.columns
              .filter((_, c) => (positions![c] as number) >= 0)
              .map((column) => column.name);
            await closeSession();
            session = await open(present);
            positions = columnPositions(session, compact, headerNames);
          }
          sessionKeys =
            names !== undefined
              ? new Set(session.columns.map((column) => column.name))
              : undefined;
          layout = {
            columns: session.columns,
            defaults: session.defaults,
            positions,
          };
          textOnly =
            strings &&
            session.columns.some((column) => needsTextParser(column.type));
        }
        if (batch.length === 0) break;
        let asText =
          jsonObjectDoc !== undefined ||
          textOnly ||
          needsServerDefaults(batch, layout!, compact, insertSettings);
        if (!asText) {
          try {
            await session!.send(batch, compact, layout!.positions);
            sessionRows += batch.length;
            progress.addSentRows(batch.length);
          } catch (err) {
            if (!(err instanceof ServerParseNeeded)) throw err;
            // The server parses these values. The next rows can have such
            // values too, so send them as text.
            asText = true;
            textOnly = true;
          }
        }
        if (asText) {
          // A Native block cannot leave out a value of one row, and the
          // client does not parse the text of all types: send the rows as
          // JSON text, and the server parses them (as over HTTP).
          await closeSession();
          const textFormat =
            jsonObjectDoc !== undefined
              ? "JSONObjectEachRow"
              : format === "JSONCompact"
                ? "JSONCompactEachRow"
                : format === "JSONCompactStrings"
                  ? "JSONCompactStringsEachRow"
                  : compact
                    ? format
                    : strings
                      ? "JSONStringsEachRow"
                      : "JSONEachRow";
          await this.insertAsText(
            socket,
            statement(params.query),
            serverSettings,
            nextQueryId(),
            jsonObjectDoc !== undefined
              ? [jsonObjectDoc]
              : compact
                ? [...headerRows, ...batch]
                : batch,
            textFormat,
          );
          dataStatements++;
          progress.addSentRows(batch.length);
        }
      }
      await closeSession();
    } catch (err) {
      // After an error of the server, the connection can run the next
      // request. In the other cases, an INSERT can wait for data.
      const reusable =
        socket.usable && (session === undefined || session.reusable);
      if (reusable) this.release(socket);
      else this.discard(socket, err as Error);
      throw err;
    }
    this.release(socket);
    return {
      query_id,
      response_headers: this.responseHeaders(socket, query_id, undefined),
      summary: progress.summary(),
    };
  }

  /** Inserts rows as JSON text after the SQL: the server parses them. */
  private async insertAsText(
    socket: NativeSocket,
    params: ConnInsertParams<Stream.Readable>,
    serverSettings: ServerSettings,
    query_id: string,
    rows: unknown[],
    textFormat: string,
  ): Promise<void> {
    const sql = params.query.replace(
      /FORMAT [A-Za-z0-9_]+$/,
      `FORMAT ${textFormat}`,
    );
    const lines = rows.map(stringifyJSON).join("\n");
    await this.execute(
      socket,
      {
        ...params,
        query: [Buffer.from(sql + "\n"), Buffer.from(lines + "\n")],
      },
      serverSettings,
      query_id,
      { ignore_error: false, release: false },
    );
  }

  /** Sends an INSERT and waits until the server asks for the data. The
   *  socket stays with the caller. */
  private async openInsert(
    socket: NativeSocket,
    params: RequestParams,
    serverSettings: ServerSettings,
    query_id: string,
    progress: ProgressTracker,
    insertSettings: InsertSettings,
  ): Promise<InsertSession> {
    const settings = params.clickhouse_settings ?? {};
    const compression = this.params.compression_method;
    const compressionLevel = this.params.compression_level;
    const header = deferred<Array<{ name: string; type: ColumnType }>>();
    const end = deferred<undefined>();
    let done = false;
    let reusable = false;
    let headerReceived = false;
    let defaults = new Set<string>();

    const finish = (
      err: Error | undefined,
      socketReusable: boolean,
      sendCancel = false,
    ) => {
      if (done) return;
      done = true;
      reusable = socketReusable;
      cleanupAbort();
      if (socketReusable) {
        socket.finish();
        socket.clearTimeout();
      } else if (sendCancel) {
        socket.cancel(err);
      } else {
        socket.destroy(err);
      }
      if (err !== undefined) {
        header.reject(err);
        end.reject(err);
      } else {
        header.reject(
          new Error("The server did not ask for the data of the INSERT"),
        );
        end.resolve(undefined);
      }
    };
    const cleanupAbort = this.onAbort(params.abort_signal, () =>
      finish(new Error(USER_ABORTED), false, true),
    );
    const handler: PacketHandler = {
      packet: (packet) => {
        switch (packet.type) {
          case "table_columns":
            defaults = columnsWithDefaults(packet.description);
            break;
          case "data":
            if (!headerReceived) {
              headerReceived = true;
              header.resolve(
                packet.block.columns.map(({ name, type }) => ({ name, type })),
              );
            }
            break;
          case "progress":
            progress.add(packet.progress);
            break;
          case "profile_events":
            progress.profileEvents(packet.block);
            break;
          case "exception":
            finish(toClickHouseError(packet.exception), true);
            break;
          case "end_of_stream":
            finish(undefined, true);
            break;
          default:
            break;
        }
      },
      error: (err) => finish(err, false),
    };
    await this.send(socket, handler, params, serverSettings, query_id).catch(
      (err) => {
        finish(err as Error, false);
        throw err;
      },
    );
    const columns = await header.promise;
    const ctx: RowContext = {
      timezone: queryTimezone(socket, settings),
      null_as_default: insertSettings.null_as_default,
      fallback_for_version_specific_values: true,
      infer_dates:
        insertSettings.try_infer_dates || insertSettings.try_infer_datetimes,
      known_fields: insertSettings.skip_unknown_fields
        ? undefined
        : new Set(columns.map((column) => column.name)),
    };
    const customSerializationFlag =
      socket.protocolRevision >= REVISION.CUSTOM_SERIALIZATION;
    return {
      columns,
      defaults,
      get reusable() {
        return reusable;
      },
      send: async (batch, compact, positions) => {
        if (done) {
          await end.promise; // throws the error of the server
          throw new Error(
            "The server ended the INSERT before the end of the data",
          );
        }
        let packet: Buffer;
        try {
          const block = encodeInsertRows(
            columns,
            batch,
            compact,
            positions,
            ctx,
          );
          packet = encodeDataPacket(
            encodeBlock(block.columns, block.rows, customSerializationFlag),
            compression,
            compressionLevel,
          );
        } catch (err) {
          // The INSERT continues: the caller sends these rows as text.
          if (err instanceof ServerParseNeeded) throw err;
          finish(err as Error, false);
          throw err;
        }
        await socket.writeAndDrain(packet);
      },
      close: async () => {
        if (!done)
          socket.write(encodeEmptyBlock(compression, compressionLevel));
        await end.promise;
      },
    };
  }

  /**
   * Runs a statement with the full SQL. The format of the result is the
   * format of a trailing `FORMAT` clause (or the `default_format` setting,
   * or TabSeparated). With `values`, the data follows the SQL and the server
   * parses it.
   */
  async exec(
    params: ConnExecParams<Stream.Readable>,
  ): Promise<ConnExecResult<Stream.Readable>> {
    const ignoreError = params.ignore_error_response ?? false;
    assertSupported(params);
    if (params.values !== undefined) {
      const input = params.values;
      const query = await this.readInput(
        input,
        this.withShutdown(params.abort_signal),
        () => readInlineQuery(params.query, input),
      );
      let errorText: string | undefined;
      const result = await this.runCommand(
        { ...params, query },
        ignoreError,
        (exception) => {
          errorText = exceptionText(exception);
        },
      );
      return {
        ...result,
        stream: Stream.Readable.from(
          errorText !== undefined ? [Buffer.from(errorText)] : [],
        ),
      };
    }
    const clauses = readQueryClauses(params.query);
    const settings = { ...params.clickhouse_settings, ...clauses.settings };
    const format = resolveFormat(
      clauses.format ?? settings.default_format ?? "TabSeparated",
    );
    const { socket, serverSettings } = await this.acquireWithSettings(
      params.abort_signal,
    );
    let encoder: OutputEncoder;
    let decode: DecodeOptions;
    try {
      const output = applyOutputSettings(serverSettings.output, settings);
      encoder = new OutputEncoder(format, output);
      decode = decodeOptions(socket, settings, output);
    } catch (err) {
      this.release(socket);
      throw err;
    }
    return this.runQuery(
      socket,
      params,
      serverSettings,
      encoder,
      format,
      decode,
      {
        ignore_error: ignoreError,
        wait_end_of_query: isTruthySetting(
          settings["wait_end_of_query"] ?? settings["http_wait_end_of_query"],
        ),
      },
    );
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private readInput<T>(
    stream: Stream.Readable,
    signal: AbortSignal,
    read: () => Promise<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        stream.destroy();
        reject(new Error(this.closed ? CLIENT_CLOSED : USER_ABORTED));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      read()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }

  /** Sends the Query packet and the empty data block that ends the external tables. */
  private async send(
    socket: NativeSocket,
    handler: PacketHandler,
    params: RequestParams,
    serverSettings: ServerSettings,
    query_id: string,
    decode?: DecodeOptions,
    uncompressed = false,
  ): Promise<void> {
    assertSupported(params);
    const compression = uncompressed
      ? undefined
      : this.params.compression_method;
    if (this.closed) throw new Error(CLIENT_CLOSED);
    if (params.abort_signal?.aborted) throw new Error(USER_ABORTED);
    const settings = params.clickhouse_settings ?? {};
    const querySettings: QuerySetting[] = [];
    for (const [name, value] of Object.entries(settings)) {
      if (value === undefined || SKIPPED_SETTINGS.has(name)) continue;
      querySettings.push({ name, value: settingValue(value), important: true });
    }
    for (const setting of serverSettings.native_form_settings) {
      if (settings[setting.name] === undefined) querySettings.push(setting);
    }
    if (
      compression !== undefined &&
      serverSettings.can_change_settings &&
      settings["network_compression_method"] === undefined
    ) {
      // The server compresses its data with the same method as the client.
      querySettings.push({
        name: "network_compression_method",
        value: compression.toUpperCase(),
        important: false,
      });
    }
    const parameters: Array<[string, string]> = [];
    for (const [name, value] of Object.entries(params.query_params ?? {})) {
      parameters.push([name, formatQueryParams({ value })]);
    }
    const packets = encodeQuery({
      query_id,
      query: params.query,
      settings: querySettings,
      parameters,
      client: this.client,
      protocol_revision: socket.protocolRevision,
      compression: compression !== undefined,
    });
    if (this.params.log_level <= ClickHouseLogLevel.TRACE) {
      this.params.log_writer.trace({
        message: "Query: sending the Query packet",
        args: { query_id, connection: socket.server.display_name },
      });
    }
    socket.setTimeout(this.params.request_timeout, () => {
      socket.cancel(new Error("Timeout error."));
    });
    socket.start(
      handler,
      [
        ...packets,
        encodeEmptyBlock(
          compression,
          uncompressed ? undefined : this.params.compression_level,
        ),
      ],
      decode?.timezone ?? queryTimezone(socket, settings),
      compression !== undefined,
      decode,
    );
  }

  /** Acquires a socket and loads server settings, returning a healthy socket
   *  back to the pool if the load is aborted or hits a transient error. */
  private async acquireWithSettings(
    signal: AbortSignal | undefined,
  ): Promise<{ socket: NativeSocket; serverSettings: ServerSettings }> {
    const socket = await this.acquire(signal);
    try {
      const serverSettings = await this.getServerSettings(socket, signal);
      return { socket, serverSettings };
    } catch (err) {
      if (socket.usable) this.release(socket);
      else this.discard(socket, err as Error);
      throw err;
    }
  }

  private onAbort(
    signal: AbortSignal | undefined,
    onAbort: () => void,
  ): () => void {
    if (signal === undefined) return () => undefined;
    if (signal.aborted) {
      queueMicrotask(onAbort);
      return () => undefined;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
  }

  private responseHeaders(
    socket: NativeSocket,
    query_id: string,
    format: DataFormat | undefined,
  ): ResponseHeaders {
    const headers: ResponseHeaders = {
      "x-clickhouse-query-id": query_id,
      "x-clickhouse-server-display-name": socket.server.display_name,
      "x-clickhouse-timezone": socket.server.timezone,
    };
    if (format !== undefined) headers["x-clickhouse-format"] = format;
    return headers;
  }

  private serverSettingsKey(socket: NativeSocket): string {
    const s = socket.server;
    return `${s.display_name}\0${s.version_major}.${s.version_minor}.${s.version_patch}\0${s.revision}`;
  }

  /** Reads the output settings of the server per backend identity with a TTL
   *  (their defaults depend on the server version and on the settings profile
   *  of the user). The request that reads them stops with its own
   *  `abort_signal`. A request that waits for the load of another request
   *  stops waiting when its own signal aborts, and reads the settings itself
   *  if that load fails. */
  private async getServerSettings(
    socket: NativeSocket,
    signal: AbortSignal | undefined,
  ): Promise<ServerSettings> {
    const key = this.serverSettingsKey(socket);
    for (;;) {
      if (signal?.aborted) throw new Error(USER_ABORTED);
      const entry = this.serverSettings.get(key);
      if (entry === undefined || Date.now() >= entry.expiresAt) {
        const promise = this.loadServerSettings(socket, signal);
        const next: CachedServerSettings = {
          promise,
          expiresAt: Date.now() + SERVER_SETTINGS_TTL_MS,
        };
        if (
          !this.serverSettings.has(key) &&
          this.serverSettings.size >= MAX_SERVER_SETTINGS_ENTRIES
        ) {
          this.serverSettings.clear();
        }
        this.serverSettings.set(key, next);
        promise.catch(() => {
          // Try again with the next request.
          if (this.serverSettings.get(key) === next) {
            this.serverSettings.delete(key);
          }
        });
        return promise;
      }
      try {
        return await abortable(entry.promise, signal);
      } catch {
        if (signal?.aborted) throw new Error(USER_ABORTED);
        // The load of another request failed: that request was aborted or
        // lost its connection. Read the settings on this socket.
        if (this.serverSettings.get(key) === entry) {
          this.serverSettings.delete(key);
        }
      }
    }
  }

  private async loadServerSettings(
    socket: NativeSocket,
    signal: AbortSignal | undefined,
  ): Promise<ServerSettings> {
    const names = [
      ...OutputSettingNames,
      ...NATIVE_FORM_SETTINGS,
      ...InsertSettingNames.map(([, name]) => name),
      "readonly",
    ];
    const values: Record<string, string> = {};
    const defaults: ServerSettings = {
      output: DefaultOutputSettings,
      insert: DefaultInsertSettings,
      native_form_settings: [],
      can_change_settings: false,
    };
    try {
      await this.execute(
        socket,
        {
          query:
            "SELECT name, value FROM system.settings WHERE name IN (" +
            names.map((n) => `'${n}'`).join(", ") +
            ")",
          abort_signal: signal,
        },
        defaults,
        crypto.randomUUID(),
        {
          ignore_error: false,
          release: false,
          // This query cannot set network_compression_method yet (a user
          // with readonly = 1 may not change it), so with compression the
          // server would answer in its own default method, which can be one
          // that this runtime cannot read (ZSTD before Node.js 22.15). Its
          // answer is small.
          uncompressed: true,
          on_block: (block) => {
            const [name, value] = block.columns;
            for (let i = 0; i < block.rows; i++) {
              values[String(name?.values[i])] = String(value?.values[i]);
            }
          },
        },
      );
    } catch (err) {
      // An abort, a lost connection, or a server error that the next
      // request may not get: the request fails and the next one tries again.
      if (
        !(err instanceof ClickHouseError) ||
        TRANSIENT_ERROR_CODES.has(err.code)
      ) {
        throw err;
      }
      // The user cannot read the settings (no grant, or a limit of the
      // settings profile): the socket is still usable, and the client
      // uses the defaults of a recent server for the life of the client.
      if (this.params.log_level <= ClickHouseLogLevel.WARN) {
        this.params.log_writer.warn({
          message:
            "Cannot read the settings of the user from system.settings. The client formats results and " +
            "encodes inserts with the defaults of a recent server, not with the user's settings profile, " +
            "unless a request sets them in clickhouse_settings.",
          err,
          args: { connection: socket.server.display_name },
        });
      }
      return defaults;
    }
    // A user with readonly = 1 cannot change any setting.
    const canChangeSettings = values["readonly"] !== "1";
    return {
      output: applyOutputSettings(DefaultOutputSettings, values),
      insert: applyInsertSettings(DefaultInsertSettings, values),
      can_change_settings: canChangeSettings,
      native_form_settings: canChangeSettings
        ? NATIVE_FORM_SETTINGS.filter((name) => values[name] !== undefined).map(
            (name) => ({ name, value: "1", important: false }),
          )
        : [],
    };
  }
}

function settingValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object" && value !== null) {
    // SettingsMap and similar objects have a toString() that the HTTP client uses.
    return String(value);
  }
  return String(value);
}

function isTruthySetting(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const text = String(value).toLowerCase();
  return text === "1" || text === "true";
}

function resolveFormat(format: string): DataFormat {
  const lower = format.toLowerCase();
  return (
    SupportedNativeFormats.find((name) => name.toLowerCase() === lower) ??
    (format as DataFormat)
  );
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // The caller may not wait for it (for example, after an error).
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function safeUserName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "";
  }
}
