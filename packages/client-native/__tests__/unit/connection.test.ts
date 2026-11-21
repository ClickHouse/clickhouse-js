import net from "node:net";
import Stream from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickHouseError, ClickHouseLogLevel, createClient } from "../../src";
import type {
  ClickHouseSpan,
  ClickHouseSpanAttributes,
  ClickHouseTracer,
  Logger,
} from "../../src";
import { exceptionText, toClickHouseError } from "../../src/connection/errors";
import {
  BinaryReader,
  BinaryWriter,
  NeedMoreData,
} from "../../src/protocol/binary";
import { encodeBlock } from "../../src/protocol/encode";
import type { ServerException } from "../../src/protocol/packets";
import {
  BLOCK_INFO,
  CLIENT_REVISION,
  ClientPacket,
  REVISION,
  ServerPacketType,
} from "../../src/protocol/packets";
import { parseColumnType } from "../../src/protocol/types";

interface ClientQuery {
  queryId: string;
  query: string;
  settings: Record<string, string>;
}

interface MockServer {
  url: string;
  connections: number;
  queries: ClientQuery[];
  cancels: number;
  sockets: Set<net.Socket>;
  close(): Promise<void>;
}

function serverHelloPacket(displayName = "mock-server"): Buffer {
  return new BinaryWriter()
    .varuint(ServerPacketType.Hello)
    .string("MockClickHouse")
    .varuint(24)
    .varuint(8)
    .varuint(CLIENT_REVISION)
    .string("UTC")
    .string(displayName)
    .varuint(1)
    .toBuffer();
}

function serverEndOfStream(): Buffer {
  return new BinaryWriter().varuint(ServerPacketType.EndOfStream).toBuffer();
}

function serverExceptionPacket(exception: ServerException): Buffer {
  const w = new BinaryWriter().varuint(ServerPacketType.Exception);
  const writeOne = (e: ServerException) => {
    w.u32(e.code >>> 0)
      .string(e.name)
      .string(e.message)
      .string(e.stack_trace)
      .u8(e.nested !== undefined ? 1 : 0);
    if (e.nested !== undefined) writeOne(e.nested);
  };
  writeOne(exception);
  return w.toBuffer();
}

function serverDataPacket(
  columns: Array<{ name: string; type: string; values: unknown[] }>,
  rows: number,
): Buffer {
  const block = encodeBlock(
    columns.map((c) => ({
      name: c.name,
      type: parseColumnType(c.type),
      values: c.values,
    })),
    rows,
    true,
  );
  return Buffer.concat([
    new BinaryWriter().varuint(ServerPacketType.Data).string("").toBuffer(),
    block,
  ]);
}

function serverTableColumnsPacket(description: string): Buffer {
  return new BinaryWriter()
    .varuint(ServerPacketType.TableColumns)
    .string("")
    .string(description)
    .toBuffer();
}

function serverProgressPacket(p: {
  read_rows: number;
  read_bytes: number;
  total_rows_to_read?: number;
  written_rows?: number;
  written_bytes?: number;
  elapsed_ns: number;
}): Buffer {
  return new BinaryWriter()
    .varuint(ServerPacketType.Progress)
    .varuint(p.read_rows)
    .varuint(p.read_bytes)
    .varuint(p.total_rows_to_read ?? 0)
    .varuint(p.written_rows ?? 0)
    .varuint(p.written_bytes ?? 0)
    .varuint(p.elapsed_ns)
    .toBuffer();
}

function serverProfileInfoPacket(p: {
  rows: number;
  blocks: number;
  bytes: number;
}): Buffer {
  return new BinaryWriter()
    .varuint(ServerPacketType.ProfileInfo)
    .varuint(p.rows)
    .varuint(p.blocks)
    .varuint(p.bytes)
    .u8(0) // applied_limit
    .varuint(0) // rows_before_limit
    .u8(0) // obsolete
    .toBuffer();
}

/** Parses one client packet (Hello, Query, Data, Cancel, Ping) from `buf`. */
function readClientPacket(
  r: BinaryReader,
  state: { handshakeDone: boolean; addendumRead: boolean },
):
  | { type: "hello" }
  | { type: "addendum" }
  | { type: "query"; query: ClientQuery }
  | { type: "data"; rows: number }
  | { type: "cancel" }
  | { type: "ping" } {
  if (state.handshakeDone && !state.addendumRead) {
    r.string(); // quota key
    return { type: "addendum" };
  }
  const type = r.varuint();
  if (type === ClientPacket.Hello) {
    r.string(); // client name
    r.varuint(); // major
    r.varuint(); // minor
    r.varuint(); // revision
    r.string(); // database
    r.string(); // username
    r.string(); // password
    return { type: "hello" };
  }
  if (type === ClientPacket.Cancel) {
    return { type: "cancel" };
  }
  if (type === ClientPacket.Ping) {
    return { type: "ping" };
  }
  if (type === ClientPacket.Data) {
    r.string(); // temp table name
    for (;;) {
      const field = r.varuint();
      if (field === 0) break;
      if (field === 1) r.u8();
      else if (field === 2) r.i32();
    }
    const cols = r.varuint();
    const rows = r.varuint();
    for (let i = 0; i < cols; i++) {
      r.string(); // name
      const colType = r.string();
      if (CLIENT_REVISION >= REVISION.CUSTOM_SERIALIZATION) r.u8();
      if (rows > 0) {
        if (colType === "UInt64") r.skip(rows * 8);
        else if (colType === "String") {
          for (let j = 0; j < rows; j++) r.string();
        } else {
          throw new Error(`Mock server cannot skip column type ${colType}`);
        }
      }
    }
    return { type: "data", rows };
  }
  if (type === ClientPacket.Query) {
    const queryId = r.string();
    // Client info
    r.u8(); // query kind
    r.string(); // initial user
    r.string(); // initial query id
    r.string(); // initial address
    r.skip(8); // initial query start time
    r.u8(); // interface
    r.string(); // os user
    r.string(); // hostname
    r.string(); // client name
    r.varuint(); // major
    r.varuint(); // minor
    r.varuint(); // revision
    r.string(); // quota key
    r.varuint(); // distributed depth
    r.varuint(); // patch
    r.u8(); // opentelemetry
    r.varuint(); // parallel replicas
    r.varuint();
    r.varuint();
    // Settings
    const settings: Record<string, string> = {};
    for (;;) {
      const name = r.string();
      if (name === "") break;
      r.varuint(); // flags
      settings[name] = r.string();
    }
    r.string(); // interserver secret
    r.varuint(); // stage
    r.varuint(); // compression
    const query = r.string();
    // Parameters
    for (;;) {
      const name = r.string();
      if (name === "") break;
      r.varuint(); // flags
      r.string(); // value
    }
    return { type: "query", query: { queryId, query, settings } };
  }
  throw new Error(`Unexpected client packet ${type}`);
}

async function startMockServer(
  onQuery: (
    q: ClientQuery,
    socket: net.Socket,
    ctx: { onDataBlock?: (rows: number) => void; connectionIndex: number },
  ) => void,
  options?: {
    displayName?: (connectionIndex: number) => string;
    onCancel?: () => void;
  },
): Promise<MockServer> {
  const queries: ClientQuery[] = [];
  let connections = 0;
  let cancels = 0;
  const openSockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    const connIndex = ++connections;
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
    let buf: Buffer = Buffer.alloc(0);
    const state = { handshakeDone: false, addendumRead: false };
    const ctx: {
      onDataBlock?: (rows: number) => void;
      connectionIndex: number;
    } = { connectionIndex: connIndex };
    let skipInitialEmptyData = false;

    socket.on("data", (chunk: Buffer) => {
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
      for (;;) {
        const r = new BinaryReader(buf);
        let pkt: ReturnType<typeof readClientPacket>;
        try {
          pkt = readClientPacket(r, state);
        } catch (err) {
          if (err instanceof NeedMoreData) break;
          socket.destroy(err as Error);
          return;
        }
        buf = buf.subarray(r.pos);
        if (pkt.type === "hello") {
          state.handshakeDone = true;
          const name = options?.displayName?.(connIndex) ?? "mock-server";
          socket.write(serverHelloPacket(name));
        } else if (pkt.type === "addendum") {
          state.addendumRead = true;
        } else if (pkt.type === "query") {
          queries.push(pkt.query);
          skipInitialEmptyData = true;
          ctx.onDataBlock = undefined;
          onQuery(pkt.query, socket, ctx);
        } else if (pkt.type === "data") {
          if (skipInitialEmptyData && pkt.rows === 0) {
            skipInitialEmptyData = false;
            continue;
          }
          ctx.onDataBlock?.(pkt.rows);
        } else if (pkt.type === "cancel") {
          cancels++;
          options?.onCancel?.();
        } else if (pkt.type === "ping") {
          socket.write(
            new BinaryWriter().varuint(ServerPacketType.Pong).toBuffer(),
          );
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;
  return {
    url: `tcp://127.0.0.1:${address.port}`,
    get connections() {
      return connections;
    },
    get cancels() {
      return cancels;
    },
    sockets: openSockets,
    queries,
    close: async () => {
      for (const s of openSockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("[Native] nested server exceptions", () => {
  it("preserves nested exception details in toClickHouseError and exceptionText", () => {
    const inner: ServerException = {
      code: 60,
      name: "DB::Exception",
      message: "DB::Exception: Table default.missing does not exist",
      stack_trace: "",
      nested: undefined,
    };
    const outer: ServerException = {
      code: 57,
      name: "DB::Exception",
      message: "DB::Exception: Error on shard 1",
      stack_trace: "",
      nested: inner,
    };

    const err = toClickHouseError(outer);
    expect(err).toBeInstanceOf(ClickHouseError);
    expect(err.code).toBe("57");
    expect(err.type).toBe("TABLE_ALREADY_EXISTS");
    expect(err.message).toBe(
      "Error on shard 1: Code: 60. DB::Exception: Table default.missing does not exist (UNKNOWN_TABLE)",
    );
    expect(err.cause).toBeInstanceOf(ClickHouseError);
    const cause = err.cause as ClickHouseError;
    expect(cause.code).toBe("60");
    expect(cause.type).toBe("UNKNOWN_TABLE");
    expect(cause.message).toBe("Table default.missing does not exist");
    expect(cause.cause).toBeUndefined();

    expect(exceptionText(outer)).toBe(
      "Code: 57. DB::Exception: Error on shard 1 (TABLE_ALREADY_EXISTS): " +
        "Code: 60. DB::Exception: Table default.missing does not exist (UNKNOWN_TABLE)\n",
    );
  });

  it("leaves single exceptions unchanged", () => {
    const single: ServerException = {
      code: 60,
      name: "DB::Exception",
      message: "DB::Exception: Table missing",
      stack_trace: "",
      nested: undefined,
    };
    const err = toClickHouseError(single);
    expect(err.message).toBe("Table missing");
    expect(err.cause).toBeUndefined();
    expect(exceptionText(single)).toBe(
      "Code: 60. DB::Exception: Table missing (UNKNOWN_TABLE)\n",
    );
  });
});

describe("[Native] NativeConnection protocol behavior", () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    if (mock !== undefined) {
      await mock.close();
      mock = undefined;
    }
  });

  it("reuses a healthy socket after a transient server error in getServerSettings", async () => {
    let settingsAttempts = 0;
    mock = await startMockServer((q, socket) => {
      if (q.query.includes("system.settings")) {
        settingsAttempts++;
        if (settingsAttempts === 1) {
          // Transient error code 202 (TOO_MANY_SIMULTANEOUS_QUERIES)
          socket.write(
            serverExceptionPacket({
              code: 202,
              name: "DB::Exception",
              message: "DB::Exception: Too many simultaneous queries",
              stack_trace: "",
              nested: undefined,
            }),
          );
          return;
        }
        socket.write(serverEndOfStream());
        return;
      }
      socket.write(serverEndOfStream());
    });

    const client = createClient({ url: mock.url });
    try {
      await expect(client.command({ query: "SELECT 1" })).rejects.toThrow(
        "Too many simultaneous queries",
      );
      await client.command({ query: "SELECT 2" });
      // The socket survived the transient error and was reused instead of reconnecting.
      expect(mock.connections).toBe(1);
    } finally {
      await client.close();
    }
  });

  it("guards loadServerSettings warning behind log_level", async () => {
    mock = await startMockServer((q, socket) => {
      if (q.query.includes("system.settings")) {
        socket.write(
          serverExceptionPacket({
            code: 497,
            name: "DB::Exception",
            message: "DB::Exception: Not enough privileges",
            stack_trace: "",
            nested: undefined,
          }),
        );
        return;
      }
      socket.write(serverEndOfStream());
    });

    const warnings: string[] = [];
    const logger: Logger = {
      trace() {},
      debug() {},
      info() {},
      warn(params) {
        warnings.push(params.message);
      },
      error() {},
    };
    const client = createClient({
      url: mock.url,
      log: {
        LoggerClass: class implements Logger {
          trace = logger.trace;
          debug = logger.debug;
          info = logger.info;
          warn = logger.warn;
          error = logger.error;
        },
        level: ClickHouseLogLevel.ERROR,
      },
    });
    try {
      await client.command({ query: "SELECT 1" });
      expect(warnings).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("writes server error text to result.stream for exec({ ignore_error_response: true, values })", async () => {
    mock = await startMockServer((q, socket) => {
      if (q.query.includes("system.settings")) {
        socket.write(serverEndOfStream());
        return;
      }
      socket.write(
        serverExceptionPacket({
          code: 60,
          name: "DB::Exception",
          message: "DB::Exception: Table missing",
          stack_trace: "",
          nested: undefined,
        }),
      );
    });

    const client = createClient({ url: mock.url });
    try {
      const res = await client.exec({
        query: "INSERT INTO missing FORMAT CSV",
        values: Stream.Readable.from([Buffer.from("1,a\n")]),
        ignore_error_response: true,
      });
      const chunks: Buffer[] = [];
      for await (const c of res.stream) chunks.push(Buffer.from(c));
      expect(Buffer.concat(chunks).toString("utf8")).toBe(
        "Code: 60. DB::Exception: Table missing (UNKNOWN_TABLE)\n",
      );
    } finally {
      await client.close();
    }
  });

  it("waits for end_of_stream when wait_end_of_query=1 so summary is complete and mid-query errors reject query()", async () => {
    let queryCount = 0;
    mock = await startMockServer((q, socket) => {
      if (q.query.includes("system.settings")) {
        socket.write(serverEndOfStream());
        return;
      }
      queryCount++;
      // First & second queries: data block followed by final Progress + ProfileInfo + EndOfStream
      if (queryCount <= 2) {
        socket.write(
          Buffer.concat([
            serverDataPacket(
              [{ name: "n", type: "UInt64", values: [1n, 2n] }],
              2,
            ),
            serverProgressPacket({
              read_rows: 2,
              read_bytes: 16,
              elapsed_ns: 123456,
            }),
            serverProfileInfoPacket({ rows: 2, blocks: 1, bytes: 16 }),
            serverEndOfStream(),
          ]),
        );
        return;
      }
      // Third query: data block followed by a mid-query Exception
      socket.write(
        Buffer.concat([
          serverDataPacket([{ name: "n", type: "UInt64", values: [1n] }], 1),
          serverExceptionPacket({
            code: 159,
            name: "DB::Exception",
            message: "DB::Exception: Timeout exceeded",
            stack_trace: "",
            nested: undefined,
          }),
        ]),
      );
    });

    const recordedSpans: Array<{
      name: string;
      attributes: ClickHouseSpanAttributes;
    }> = [];
    const tracer: ClickHouseTracer = {
      startActiveSpan(name, options, fn) {
        const record = { name, attributes: { ...options.attributes } };
        recordedSpans.push(record);
        const span: ClickHouseSpan = {
          setAttributes(attrs) {
            Object.assign(record.attributes, attrs);
          },
          setStatus() {},
          recordException() {},
          end() {},
        };
        return fn(span);
      },
    };

    const client = createClient({ url: mock.url, tracer });
    try {
      const rs = await client.query({
        query: "SELECT n FROM t",
        format: "JSONEachRow",
        clickhouse_settings: { wait_end_of_query: 1 },
      });
      const querySpan = recordedSpans.find(
        (s) => s.name === "clickhouse.query",
      );
      expect(querySpan?.attributes).toMatchObject({
        "clickhouse.summary.read_rows": "2",
        "clickhouse.summary.read_bytes": "16",
        "clickhouse.summary.result_rows": "2",
        "clickhouse.summary.result_bytes": "16",
        "clickhouse.summary.elapsed_ns": "123456",
      });
      expect(await rs.json()).toEqual([{ n: 1 }, { n: 2 }]);

      const execRes = await client.exec({
        query: "SELECT n FROM t FORMAT JSONEachRow",
        clickhouse_settings: { wait_end_of_query: 1 },
      });
      expect(execRes.summary).toMatchObject({
        read_rows: "2",
        read_bytes: "16",
        result_rows: "2",
        result_bytes: "16",
        elapsed_ns: "123456",
      });
      execRes.stream.resume();

      await expect(
        client.query({
          query: "SELECT n FROM failing_t",
          format: "JSONEachRow",
          clickhouse_settings: { wait_end_of_query: 1 },
        }),
      ).rejects.toThrow("Timeout exceeded");
    } finally {
      await client.close();
    }
  });

  it("assigns distinct query_ids for split insertRows statements and uses JSONCompactEachRow on JSONCompact text fallback", async () => {
    mock = await startMockServer((q, socket, ctx) => {
      if (q.query.includes("system.settings")) {
        socket.write(serverEndOfStream());
        return;
      }
      if (q.query.includes("\n")) {
        // Inline text fallback statement (insertAsText)
        socket.write(serverEndOfStream());
        return;
      }
      // Native INSERT handshake: send TableColumns with a DEFAULT column + empty header block
      socket.write(
        Buffer.concat([
          serverTableColumnsPacket("`id` UInt64\n`def` String\tDEFAULT\t'x'"),
          new BinaryWriter()
            .varuint(ServerPacketType.Data)
            .string("")
            .raw(BLOCK_INFO)
            .varuint(2)
            .varuint(0)
            .string("id")
            .string("UInt64")
            .u8(0)
            .string("def")
            .string("String")
            .u8(0)
            .toBuffer(),
        ]),
      );
      ctx.onDataBlock = (rows) => {
        if (rows === 0) socket.write(serverEndOfStream());
      };
    });

    const client = createClient({ url: mock.url });
    try {
      // JSONCompact with a null in a DEFAULT column triggers closeSession() + insertAsText()
      await client.insert({
        table: "t",
        format: "JSONCompact",
        query_id: "batch-qid",
        values: {
          meta: [
            { name: "id", type: "UInt64" },
            { name: "def", type: "String" },
          ],
          data: [[1, null]],
        },
      });
      const insertQueries = mock.queries.filter(
        (q) => !q.query.includes("system.settings"),
      );
      expect(insertQueries).toHaveLength(2);
      expect(insertQueries[0]?.queryId).toBe("batch-qid");
      expect(insertQueries[1]?.queryId).toBe("batch-qid_2");
      expect(insertQueries[1]?.query).toMatch(
        /^INSERT INTO t FORMAT JSONCompactEachRow\n\[1,null\]\n$/,
      );
    } finally {
      await client.close();
    }
  });

  it("streams multi-chunk raw inserts without copying through readInlineQuery", async () => {
    mock = await startMockServer((q, socket) => {
      socket.write(serverEndOfStream());
      void q;
    });

    const client = createClient({ url: mock.url });
    try {
      await client.insert({
        table: "t",
        format: "CSV",
        values: Stream.Readable.from(
          [Buffer.from("1,a\n"), Buffer.from("2,b\n"), Buffer.from("3,c\n")],
          { objectMode: false },
        ),
      });
      const insert = mock.queries.find(
        (q) => !q.query.includes("system.settings"),
      );
      expect(insert?.query).toBe("INSERT INTO t FORMAT CSV\n1,a\n2,b\n3,c\n");
    } finally {
      await client.close();
    }
  });

  it("applies per-packet backpressure when many blocks arrive in one TCP read", async () => {
    const totalBlocks = 15;
    mock = await startMockServer((q, socket) => {
      if (q.query.includes("system.settings")) {
        socket.write(serverEndOfStream());
        return;
      }
      const packets: Buffer[] = [];
      for (let i = 0; i < totalBlocks; i++) {
        packets.push(
          serverDataPacket(
            [{ name: "n", type: "UInt64", values: [BigInt(i)] }],
            1,
          ),
        );
      }
      packets.push(serverEndOfStream());
      // Send all 15 blocks + EndOfStream in a single write.
      socket.write(Buffer.concat(packets));
    });

    const client = createClient({ url: mock.url });
    try {
      const rs = await client.query({
        query: "SELECT n FROM many",
        format: "JSONEachRow",
      });
      const values: number[] = [];
      for await (const batch of rs.stream<{ n: number }>()) {
        for (const row of batch) values.push(row.json().n);
      }
      expect(values).toEqual(Array.from({ length: totalBlocks }, (_, i) => i));
    } finally {
      await client.close();
    }
  });

  it("evicts dead idle sockets immediately and reconnects on the next request", async () => {
    mock = await startMockServer((q, socket) => {
      socket.write(serverEndOfStream());
      void q;
    });

    const client = createClient({ url: mock.url, max_open_connections: 1 });
    try {
      await client.command({ query: "SELECT 1" });
      expect(mock.connections).toBe(1);
      // Close the idle socket from the server side.
      for (const s of mock.sockets) s.destroy();
      await new Promise((resolve) => setTimeout(resolve, 30));

      await client.command({ query: "SELECT 2" });
      expect(mock.connections).toBe(2);
    } finally {
      await client.close();
    }
  });

  it("sends ClientPacket.Cancel on abort, timeout, and early ResultSet.close()", async () => {
    let cancelResolve: (() => void) | undefined;
    const waitForCancel = () =>
      new Promise<void>((resolve) => {
        cancelResolve = resolve;
      });

    mock = await startMockServer(
      (q, socket) => {
        if (q.query.includes("system.settings")) {
          socket.write(serverEndOfStream());
          return;
        }
        if (q.query.includes("EARLY_CLOSE")) {
          // Send one block, then hold the stream open so ResultSet.close() cancels it.
          socket.write(
            serverDataPacket([{ name: "n", type: "UInt64", values: [1n] }], 1),
          );
          return;
        }
        // Hold query open until client cancels (abort / timeout).
      },
      {
        onCancel: () => {
          cancelResolve?.();
          cancelResolve = undefined;
        },
      },
    );

    const client = createClient({ url: mock.url, request_timeout: 120 });
    try {
      // 1. Abort
      const ac = new AbortController();
      const cancel1 = waitForCancel();
      const abortPromise = client.command({
        query: "SELECT sleep(10)",
        abort_signal: ac.signal,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      ac.abort();
      await expect(abortPromise).rejects.toThrow(/aborted/i);
      await cancel1;

      // 2. Early ResultSet.close()
      const cancel2 = waitForCancel();
      const rs = await client.query({
        query: "SELECT 1 AS n /* EARLY_CLOSE */",
        format: "JSONEachRow",
      });
      rs.close();
      await cancel2;

      // 3. Request timeout
      const cancel3 = waitForCancel();
      await expect(
        client.command({ query: "SELECT sleep(10) /* TIMEOUT */" }),
      ).rejects.toThrow("Timeout error.");
      await cancel3;

      expect(mock.cancels).toBe(3);
    } finally {
      await client.close();
    }
  });

  it("scopes serverSettings by backend identity and refreshes after TTL", async () => {
    let settingsQueries = 0;
    let now = Date.now();
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    mock = await startMockServer(
      (q, socket) => {
        if (q.query.includes("system.settings")) {
          settingsQueries++;
        }
        socket.write(serverEndOfStream());
      },
      {
        displayName: (connIndex) => (connIndex === 1 ? "node-a" : "node-b"),
      },
    );

    const client = createClient({ url: mock.url, max_open_connections: 2 });
    try {
      // First connection -> node-a: loads settings once.
      await client.command({ query: "SELECT 1" });
      await client.command({ query: "SELECT 2" });
      expect(settingsQueries).toBe(1);

      // Advance time past the 5-minute TTL -> refreshes settings on node-a.
      now += 5 * 60_000 + 1;
      await client.command({ query: "SELECT 3" });
      expect(settingsQueries).toBe(2);

      // Force a second connection to a different backend identity (node-b).
      for (const s of mock.sockets) s.destroy();
      await new Promise((resolve) => setTimeout(resolve, 30));
      await client.command({ query: "SELECT 4" });
      expect(settingsQueries).toBe(3);
    } finally {
      dateSpy.mockRestore();
      await client.close();
    }
  });
});
