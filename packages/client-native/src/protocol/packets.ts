import {
  BinaryReader,
  BinaryWriter,
  NeedMoreData,
  ProtocolError,
} from "./binary";
import type { NativeCompressionMethod } from "../compression/frames";
import { compressFrames, readCompressedFrame } from "../compression/frames";
import type { DecodeContext, PendingBlock } from "./columns";
import {
  GrowableBuffer,
  readBinaryColumn,
  readColumn,
  readPrefix,
} from "./columns";
import type { ColumnType } from "./types";
import { parseColumnType } from "./types";

/** The protocol revision of this client. The server and the client use the
 *  smaller of their two revisions. This revision includes the query
 *  parameters and the elapsed time in Progress packets. */
export const CLIENT_REVISION = 54460;
/** The oldest revision that this client supports: the settings are sent as strings. */
export const MIN_SERVER_REVISION = 54429;

export const REVISION = {
  SERVER_TIMEZONE: 54058,
  QUOTA_KEY_IN_CLIENT_INFO: 54060,
  SERVER_DISPLAY_NAME: 54372,
  VERSION_PATCH: 54401,
  CLIENT_WRITE_INFO: 54420,
  INTERSERVER_SECRET: 54441,
  OPENTELEMETRY: 54442,
  DISTRIBUTED_DEPTH: 54448,
  INITIAL_QUERY_START_TIME: 54449,
  PARALLEL_REPLICAS: 54453,
  CUSTOM_SERIALIZATION: 54454,
  ADDENDUM: 54458,
  PARAMETERS: 54459,
  SERVER_QUERY_TIME_IN_PROGRESS: 54460,
  TOTAL_BYTES_IN_PROGRESS: 54463,
} as const;

export const ClientPacket = {
  Hello: 0,
  Query: 1,
  Data: 2,
  Cancel: 3,
  Ping: 4,
} as const;

export const ServerPacketType = {
  Hello: 0,
  Data: 1,
  Exception: 2,
  Progress: 3,
  Pong: 4,
  EndOfStream: 5,
  ProfileInfo: 6,
  Totals: 7,
  Extremes: 8,
  TablesStatusResponse: 9,
  Log: 10,
  TableColumns: 11,
  PartUUIDs: 12,
  ReadTaskRequest: 13,
  ProfileEvents: 14,
  TimezoneUpdate: 17,
} as const;

const QUERY_STAGE_COMPLETE = 2;
const QUERY_KIND_INITIAL = 1;
const INTERFACE_TCP = 1;
const SETTING_FLAG_IMPORTANT = 0x01;
const SETTING_FLAG_CUSTOM = 0x02;

export interface ClientIdentity {
  name: string;
  version_major: number;
  version_minor: number;
  version_patch: number;
  os_user: string;
  hostname: string;
}

export interface ServerInfo {
  name: string;
  version_major: number;
  version_minor: number;
  version_patch: number;
  /** The revision of the server. */
  revision: number;
  /** The revision that the connection uses: min(client, server). */
  protocol_revision: number;
  timezone: string;
  display_name: string;
}

export function encodeHello(
  client: ClientIdentity,
  database: string,
  username: string,
  password: string,
): Buffer {
  for (const [name, value] of [
    ["database", database],
    ["username", username],
    ["password", password],
  ] as const) {
    // The server rejects control characters in these fields.
    // eslint-disable-next-line no-control-regex -- the check needs them
    if (/[\x00-\x1f\x7f]/.test(value)) {
      throw new Error(`The ${name} must not contain ASCII control characters`);
    }
  }
  return new BinaryWriter()
    .varuint(ClientPacket.Hello)
    .string(client.name)
    .varuint(client.version_major)
    .varuint(client.version_minor)
    .varuint(CLIENT_REVISION)
    .string(database)
    .string(username)
    .string(password)
    .toBuffer();
}

/** The "addendum" that follows the server Hello (the quota key). */
export function encodeAddendum(protocolRevision: number): Buffer {
  const w = new BinaryWriter();
  if (protocolRevision >= REVISION.ADDENDUM) {
    w.string(""); // quota key
  }
  return w.toBuffer();
}

export function readServerHello(r: BinaryReader): ServerInfo {
  const name = r.string();
  const version_major = r.varuint();
  const version_minor = r.varuint();
  const revision = r.varuint();
  const protocol_revision = Math.min(revision, CLIENT_REVISION);
  const timezone =
    protocol_revision >= REVISION.SERVER_TIMEZONE ? r.string() : "UTC";
  const display_name =
    protocol_revision >= REVISION.SERVER_DISPLAY_NAME ? r.string() : "";
  const version_patch =
    protocol_revision >= REVISION.VERSION_PATCH ? r.varuint() : revision;
  return {
    name,
    version_major,
    version_minor,
    version_patch,
    revision,
    protocol_revision,
    timezone,
    display_name,
  };
}

export interface QuerySetting {
  name: string;
  value: string;
  /** An important setting makes the query fail on a server that does not
   *  know it. Other unknown settings are ignored by the server. */
  important: boolean;
}

export interface QueryPacketParams {
  query_id: string;
  /** The SQL; a Buffer when data in any format (also binary) follows the SQL. */
  query: string | Buffer;
  settings: QuerySetting[];
  /** Parameters in the text form of the HTTP interface (`param_<name>`). */
  parameters: Array<[string, string]>;
  client: ClientIdentity;
  protocol_revision: number;
  /** Compress the data blocks of the query (in both directions). */
  compression: boolean;
}

export function encodeQuery(params: QueryPacketParams): Buffer {
  const rev = params.protocol_revision;
  const w = new BinaryWriter()
    .varuint(ClientPacket.Query)
    .string(params.query_id);

  // Client info
  w.u8(QUERY_KIND_INITIAL)
    .string("") // initial user
    .string("") // initial query id
    .string("0.0.0.0:0"); // initial address
  if (rev >= REVISION.INITIAL_QUERY_START_TIME) {
    w.i64(0);
  }
  w.u8(INTERFACE_TCP)
    .string(params.client.os_user)
    .string(params.client.hostname)
    .string(params.client.name)
    .varuint(params.client.version_major)
    .varuint(params.client.version_minor)
    .varuint(CLIENT_REVISION);
  if (rev >= REVISION.QUOTA_KEY_IN_CLIENT_INFO) {
    w.string(""); // quota key
  }
  if (rev >= REVISION.DISTRIBUTED_DEPTH) {
    w.varuint(0);
  }
  if (rev >= REVISION.VERSION_PATCH) {
    w.varuint(params.client.version_patch);
  }
  if (rev >= REVISION.OPENTELEMETRY) {
    w.u8(0); // no trace context
  }
  if (rev >= REVISION.PARALLEL_REPLICAS) {
    w.varuint(0).varuint(0).varuint(0);
  }

  // Settings, as strings with flags
  for (const setting of params.settings) {
    w.string(setting.name)
      .varuint(setting.important ? SETTING_FLAG_IMPORTANT : 0)
      .string(setting.value);
  }
  w.string(""); // end of settings

  if (rev >= REVISION.INTERSERVER_SECRET) {
    w.string(""); // no inter-server secret
  }
  w.varuint(QUERY_STAGE_COMPLETE).varuint(params.compression ? 1 : 0);
  if (typeof params.query === "string") w.string(params.query);
  else w.bytes(params.query);

  if (rev >= REVISION.PARAMETERS) {
    for (const [name, value] of params.parameters) {
      // Custom settings carry a dumped Field: a quoted string.
      w.string(name).varuint(SETTING_FLAG_CUSTOM).string(quoteField(value));
    }
    w.string(""); // end of parameters
  } else if (params.parameters.length > 0) {
    throw new Error(
      `The server (protocol revision ${rev}) does not support query parameters over the native protocol`,
    );
  }
  return w.toBuffer();
}

function quoteField(value: string): string {
  return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

/** An empty Data packet: the end of the (external) data. */
/** The block info that starts each block: is_overflows = false,
 *  bucket_num = -1, end of fields. */
export const BLOCK_INFO = Buffer.from([1, 0, 2, 0xff, 0xff, 0xff, 0xff, 0]);

/** A Data packet with the encoded block (block info, columns and rows).
 *  With compression, the block is in compressed blocks of 1 MiB at most, as
 *  the server sends them. */
export function encodeDataPacket(
  block: Buffer,
  compression: NativeCompressionMethod | undefined,
): Buffer {
  const head = new BinaryWriter()
    .varuint(ClientPacket.Data)
    .string("")
    .toBuffer();
  return Buffer.concat(
    compression === undefined
      ? [head, block]
      : [head, ...compressFrames(block, compression)],
  );
}

/** An empty Data packet: the end of the (external or INSERT) data. */
export function encodeEmptyBlock(
  compression?: NativeCompressionMethod,
): Buffer {
  return encodeDataPacket(
    Buffer.concat([BLOCK_INFO, Buffer.from([0, 0])]),
    compression,
  );
}

export function encodePing(): Buffer {
  return new BinaryWriter().varuint(ClientPacket.Ping).toBuffer();
}

export function encodeCancel(): Buffer {
  return new BinaryWriter().varuint(ClientPacket.Cancel).toBuffer();
}

// ---------------------------------------------------------------------------
// Server packets
// ---------------------------------------------------------------------------

export interface Column {
  name: string;
  type: ColumnType;
  values: unknown[];
  binary?: Buffer;
}

export interface Block {
  columns: Column[];
  rows: number;
}

export interface Progress {
  read_rows: number;
  read_bytes: number;
  total_rows_to_read: number;
  total_bytes_to_read: number;
  written_rows: number;
  written_bytes: number;
  elapsed_ns: number;
}

export interface ProfileInfo {
  rows: number;
  blocks: number;
  bytes: number;
  applied_limit: boolean;
  rows_before_limit: number;
}

export interface ServerException {
  code: number;
  name: string;
  message: string;
  stack_trace: string;
  nested: ServerException | undefined;
}

export type ServerPacket =
  | { type: "hello"; info: ServerInfo }
  | { type: "data"; block: Block }
  | { type: "totals"; block: Block }
  | { type: "extremes"; block: Block }
  | { type: "exception"; exception: ServerException }
  | { type: "progress"; progress: Progress }
  | { type: "pong" }
  | { type: "end_of_stream" }
  | { type: "profile_info"; info: ProfileInfo }
  | { type: "table_columns"; description: string }
  | { type: "log" }
  | { type: "profile_events"; block: Block }
  | { type: "timezone_update"; timezone: string }
  | { type: "ignored" };

/**
 * Parses one server packet. Throws {@link NeedMoreData} when the buffer
 * does not contain the full packet.
 *
 * After {@link NeedMoreData}, call the function again with the same `ctx` and
 * with a reader at the start of the same packet, when the buffer has more
 * data. The function keeps in `ctx.pending` the columns that it decoded, and
 * does not decode them again.
 */
export function readServerPacket(
  r: BinaryReader,
  protocolRevision: number,
  ctx: DecodeContext,
): ServerPacket {
  const packet = readPacket(r, protocolRevision, ctx);
  ctx.pending = undefined;
  return packet;
}

function readPacket(
  r: BinaryReader,
  protocolRevision: number,
  ctx: DecodeContext,
): ServerPacket {
  const type = r.varuint();
  switch (type) {
    case ServerPacketType.Hello:
      return { type: "hello", info: readServerHello(r) };
    case ServerPacketType.Data:
      r.string(); // external table name
      return {
        type: "data",
        block: readDataBlock(
          r,
          protocolRevision,
          ctx,
          ctx.binary_columns?.enabled,
        ),
      };
    case ServerPacketType.Totals:
      r.string();
      return { type: "totals", block: readDataBlock(r, protocolRevision, ctx) };
    case ServerPacketType.Extremes:
      r.string();
      return {
        type: "extremes",
        block: readDataBlock(r, protocolRevision, ctx),
      };
    case ServerPacketType.Exception:
      return { type: "exception", exception: readException(r) };
    case ServerPacketType.Progress:
      return { type: "progress", progress: readProgress(r, protocolRevision) };
    case ServerPacketType.Pong:
      return { type: "pong" };
    case ServerPacketType.EndOfStream:
      return { type: "end_of_stream" };
    case ServerPacketType.ProfileInfo:
      return { type: "profile_info", info: readProfileInfo(r) };
    case ServerPacketType.TableColumns:
      r.string(); // external table name
      return { type: "table_columns", description: r.string() };
    case ServerPacketType.Log:
      r.string();
      readBlock(r, protocolRevision, ctx, pendingBlock(ctx));
      return { type: "log" };
    case ServerPacketType.ProfileEvents:
      r.string();
      return {
        type: "profile_events",
        block: readBlock(r, protocolRevision, ctx, pendingBlock(ctx)),
      };
    case ServerPacketType.PartUUIDs: {
      const count = r.varuint();
      r.skip(count * 16);
      return { type: "ignored" };
    }
    case ServerPacketType.TimezoneUpdate:
      return { type: "timezone_update", timezone: r.string() };
    default:
      throw new ProtocolError(`Unknown packet ${type} from the server`);
  }
}

function pendingBlock(ctx: DecodeContext): PendingBlock {
  const pending = (ctx.pending ??= {});
  return (pending.block ??= { column_count: 0, rows: 0, offset: 0 });
}

/** Reads the block of a Data, Totals or Extremes packet. When the request is
 *  compressed, the block is in one or more compressed blocks; the server ends
 *  the last compressed block at the end of the data block. */
function readDataBlock(
  r: BinaryReader,
  protocolRevision: number,
  ctx: DecodeContext,
  binaryColumns = false,
): Block {
  const state = pendingBlock(ctx);
  if (!ctx.compressed)
    return readBlock(r, protocolRevision, ctx, state, binaryColumns);
  // The client does not know how many compressed blocks the data block has:
  // it tries to decode the data after each one. The state keeps the
  // compressed blocks that are read, and the columns that are decoded, so
  // that each try continues the try before it.
  const pending = ctx.pending as NonNullable<DecodeContext["pending"]>;
  const data = (pending.data ??= new GrowableBuffer());
  const start = r.pos;
  r.pos = start + (pending.frames_offset ?? 0);
  for (;;) {
    let frame: Buffer;
    try {
      frame = readCompressedFrame(r);
    } catch (err) {
      // With the bytes of this compressed block, the next try has more data.
      if (err instanceof NeedMoreData) err.firm = true;
      throw err;
    }
    pending.frames_offset = r.pos - start;
    data.append(frame);
    const view = data.view();
    const inner = new BinaryReader(view);
    try {
      const block = readBlock(
        inner,
        protocolRevision,
        ctx,
        state,
        binaryColumns,
      );
      if (inner.pos !== view.length) {
        throw new ProtocolError("Unexpected data after a compressed block");
      }
      return block;
    } catch (err) {
      // The block continues in the next compressed block.
      if (!(err instanceof NeedMoreData)) throw err;
      if (state.columns !== undefined && state.offset > 0) {
        // The decoded columns do not need their bytes.
        data.consume(state.offset);
        state.offset = 0;
      }
    }
  }
}

/**
 * Reads a block. With `state`, a call that stops with {@link NeedMoreData}
 * keeps the columns that it decoded. The next call with the same state, on
 * a reader at the same block start, continues after these columns.
 */
export function readBlock(
  r: BinaryReader,
  protocolRevision: number,
  ctx: DecodeContext,
  state?: PendingBlock,
  binaryColumns = false,
): Block {
  const start = r.pos;
  let columns: Column[];
  let columnCount: number;
  let rows: number;
  if (state?.columns !== undefined) {
    columns = state.columns;
    columnCount = state.column_count;
    rows = state.rows;
    r.pos = start + state.offset;
  } else {
    // Block info: numbered fields until 0
    for (;;) {
      const field = r.varuint();
      if (field === 0) break;
      if (field === 1)
        r.u8(); // is_overflows
      else if (field === 2)
        r.i32(); // bucket_num
      else throw new ProtocolError(`Unknown block info field ${field}`);
    }
    columnCount = r.varuint();
    rows = r.varuint();
    columns = [];
    if (state !== undefined) {
      state.columns = columns;
      state.column_count = columnCount;
      state.rows = rows;
      state.offset = r.pos - start;
    }
  }
  for (let i = columns.length; i < columnCount; i++) {
    const name = r.string();
    const type = parseColumnType(r.string());
    if (protocolRevision >= REVISION.CUSTOM_SERIALIZATION) {
      if (r.u8() !== 0) {
        throw new ProtocolError(
          `Custom serialization of column ${name} is not supported`,
        );
      }
    }
    const binary =
      rows > 0 && binaryColumns ? readBinaryColumn(r, type, rows) : undefined;
    if (binary !== undefined) {
      let values: unknown[] | undefined;
      columns.push({
        name,
        type,
        binary,
        get values() {
          return (values ??= readColumn(
            new BinaryReader(binary),
            type,
            rows,
            undefined,
            ctx,
          ));
        },
      });
    } else if (rows > 0) {
      const prefix = readPrefix(r, type);
      columns.push({
        name,
        type,
        values: readColumn(r, type, rows, prefix, ctx),
      });
    } else {
      columns.push({ name, type, values: [] });
    }
    if (state !== undefined) state.offset = r.pos - start;
  }
  return { columns, rows };
}

function readException(r: BinaryReader): ServerException {
  const code = r.i32();
  const name = r.string();
  const message = r.string();
  const stack_trace = r.string();
  const hasNested = r.bool();
  return {
    code,
    name,
    message,
    stack_trace,
    nested: hasNested ? readException(r) : undefined,
  };
}

function readProgress(r: BinaryReader, rev: number): Progress {
  const read_rows = r.varuint();
  const read_bytes = r.varuint();
  const total_rows_to_read = r.varuint();
  const total_bytes_to_read =
    rev >= REVISION.TOTAL_BYTES_IN_PROGRESS ? r.varuint() : 0;
  let written_rows = 0;
  let written_bytes = 0;
  if (rev >= REVISION.CLIENT_WRITE_INFO) {
    written_rows = r.varuint();
    written_bytes = r.varuint();
  }
  const elapsed_ns =
    rev >= REVISION.SERVER_QUERY_TIME_IN_PROGRESS ? r.varuint() : 0;
  return {
    read_rows,
    read_bytes,
    total_rows_to_read,
    total_bytes_to_read,
    written_rows,
    written_bytes,
    elapsed_ns,
  };
}

function readProfileInfo(r: BinaryReader): ProfileInfo {
  const rows = r.varuint();
  const blocks = r.varuint();
  const bytes = r.varuint();
  const applied_limit = r.bool();
  const rows_before_limit = r.varuint();
  r.bool(); // obsolete field
  return { rows, blocks, bytes, applied_limit, rows_before_limit };
}
