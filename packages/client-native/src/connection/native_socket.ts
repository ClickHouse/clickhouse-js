import net from "node:net";
import tls from "node:tls";
import { BinaryReader, NeedMoreData } from "../protocol/binary";
import type { DateTimeOutputFormat } from "../protocol/text";
import type { DecodeContext } from "../protocol/columns";
import { GrowableBuffer } from "../protocol/columns";
import type {
  ClientIdentity,
  ServerInfo,
  ServerPacket,
} from "../protocol/packets";
import {
  CLIENT_REVISION,
  MIN_SERVER_REVISION,
  encodeAddendum,
  encodeCancel,
  encodeHello,
  readServerPacket,
} from "../protocol/packets";
import { toClickHouseError } from "./errors";

export type NativeTLSOptions =
  | { type: "Basic"; ca_cert: Buffer }
  | { type: "Mutual"; ca_cert: Buffer; cert: Buffer; key: Buffer };

export interface NativeSocketOptions {
  host: string;
  port: number;
  secure: boolean;
  tls: NativeTLSOptions | undefined;
  connect_timeout: number;
  database: string;
  username: string;
  password: string;
  client: ClientIdentity;
}

/** Receives the packets of the current request. */
export interface PacketHandler {
  packet(packet: ServerPacket): void;
  /** The socket failed or closed. The socket cannot be used after this. */
  error(err: Error): void;
}

/**
 * One TCP (or TLS) connection to the server, after the handshake.
 * It parses the packets from the server and gives them to the handler of the
 * current request. One request at a time can use a socket.
 */
export class NativeSocket {
  readonly server: ServerInfo;
  private readonly socket: net.Socket;
  private ctx: DecodeContext;
  private handler: PacketHandler | undefined;
  /** The data that is not parsed yet: one chunk from the socket (the usual
   *  case, no copy), or the collected chunks in {@link collected}. */
  private chunk: Buffer | undefined;
  private readonly collected = new GrowableBuffer();
  private buffered = 0;
  /**
   * The Native format does not tell the length of a Data packet. The socket
   * parses the buffered data, and parses again when more data comes. The
   * packet reader keeps the columns that it decoded (see `ctx.pending`), so
   * a new try decodes only the column that was not complete.
   *
   * A try costs time for that column. Thus the socket does not try for each
   * chunk of data:
   * - No try can succeed before the buffer has {@link needed} bytes.
   * - When the reader asked for the rest of a compressed block, or for many
   *   more bytes (more than 1/8 of the buffer), the socket tries as soon as
   *   it has them ({@link eager}).
   * - If not, the next try waits until the buffer is twice as large
   *   ({@link retryAt}). If no more data comes for a short time, a timer
   *   tries again ({@link idleTimer}), because the end of the packet can be
   *   in the buffer already.
   */
  private retryAt = 0;
  /** No try can succeed before the buffer has this many bytes. */
  private needed = 0;
  private eager = false;
  private idleTimer:
    { immediate: NodeJS.Immediate } | { timeout: NodeJS.Timeout } | undefined;
  /** The wait before a try without new data, in ms. 0: until the socket has
   *  no more data in this turn of the event loop. Each such try that fails
   *  makes the wait longer. */
  private idleDelay = 0;
  private paused = false;
  private cancelling = false;
  private failure: Error | undefined;
  private timeoutHandler: (() => void) | undefined;
  private closeListener: (() => void) | undefined;

  private constructor(socket: net.Socket, server: ServerInfo) {
    this.socket = socket;
    this.server = server;
    this.ctx = { timezone: server.timezone };
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (err) => this.fail(err));
    socket.on("close", () =>
      this.fail(new Error("The connection to the ClickHouse server is closed")),
    );
  }

  /** Opens a connection and does the handshake. */
  static async connect(
    options: NativeSocketOptions,
    signal: AbortSignal,
  ): Promise<NativeSocket> {
    const socket = await openSocket(options, signal);
    try {
      const server = await handshake(socket, options, signal);
      signal.throwIfAborted();
      return new NativeSocket(socket, server);
    } catch (err) {
      socket.destroy();
      throw err;
    }
  }

  get protocolRevision(): number {
    return this.server.protocol_revision;
  }

  /** True if the socket can run a request. */
  get usable(): boolean {
    return this.failure === undefined && !this.socket.destroyed;
  }

  /** Starts a request: sends the data and gives the packets to the handler. */
  start(
    handler: PacketHandler,
    data: Buffer[],
    timezone: string,
    compressed = false,
    decode?: {
      date_time_output_format?: DateTimeOutputFormat;
      date_time64_cut_zeros?: boolean;
      binary_columns?: DecodeContext["binary_columns"];
    },
  ): void {
    if (this.handler !== undefined) {
      throw new Error("The socket already runs a request");
    }
    if (this.failure !== undefined) {
      throw this.failure;
    }
    this.handler = handler;
    this.paused = false;
    // Use a fresh context per request so nothing returned to a previous
    // caller can observe mutations from a later request on the same socket.
    this.ctx = {
      timezone,
      compressed,
      consume_frames: true,
      date_time_output_format: decode?.date_time_output_format,
      date_time64_cut_zeros: decode?.date_time64_cut_zeros,
      binary_columns: decode?.binary_columns,
      raw_bytes: false,
      pending: undefined,
    };
    if (data.length > 1) {
      this.socket.cork();
      try {
        for (const buf of data) this.socket.write(buf);
      } finally {
        this.socket.uncork();
      }
    } else if (data.length === 1) {
      this.socket.write(data[0]!);
    }
  }

  /** True when a string of the current request had bytes that are not
   *  UTF-8. Then the text of the result must go through `encodeText`. */
  get rawBytes(): boolean {
    return this.ctx.raw_bytes === true;
  }

  /** Sends data and waits until the socket can take more (backpressure). */
  writeAndDrain(data: Buffer): Promise<void> {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.socket.write(data)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onDrain = () => {
        this.socket.removeListener("close", onClose);
        resolve();
      };
      const onClose = () => {
        this.socket.removeListener("drain", onDrain);
        reject(this.failure ?? new Error("The connection is closed"));
      };
      this.socket.once("drain", onDrain);
      this.socket.once("close", onClose);
    });
  }

  /** Sends more data in the current request. */
  write(data: Buffer): void {
    this.socket.write(data);
  }

  /** Registers a one-time callback invoked when the socket fails or closes. */
  onClose(listener: () => void): void {
    if (this.failure !== undefined || this.socket.destroyed) {
      listener();
      return;
    }
    this.closeListener = listener;
  }

  /** Ends the current request. The socket can run the next request. */
  finish(): void {
    this.handler = undefined;
    this.paused = false;
  }

  /** Calls `onTimeout` if the socket gets no data for `ms` milliseconds. */
  setTimeout(ms: number, onTimeout: () => void): void {
    this.clearTimeout();
    this.timeoutHandler = onTimeout;
    this.socket.setTimeout(ms, onTimeout);
  }

  clearTimeout(): void {
    if (this.timeoutHandler !== undefined) {
      this.socket.removeListener("timeout", this.timeoutHandler);
      this.timeoutHandler = undefined;
    }
    this.socket.setTimeout(0);
  }

  pause(): void {
    this.paused = true;
    this.cancelIdleTimer();
    this.socket.pause();
  }

  resume(): void {
    if (!this.paused) {
      this.socket.resume();
      return;
    }
    this.paused = false;
    if (
      this.buffered > 0 &&
      this.handler !== undefined &&
      this.failure === undefined
    ) {
      // Drain buffered packets asynchronously so stream.read() -> resume() ->
      // push() -> pause() cannot recurse deeply on the stack.
      queueMicrotask(() => {
        if (
          !this.paused &&
          this.buffered > 0 &&
          this.handler !== undefined &&
          this.failure === undefined
        ) {
          this.schedule();
        }
        if (!this.paused && this.failure === undefined) {
          this.socket.resume();
        }
      });
    } else {
      this.socket.resume();
    }
  }

  /** Sends `ClientPacket.Cancel` so the server stops a running query promptly,
   *  then closes the socket once the 1-byte packet is flushed. */
  cancel(err?: Error): void {
    const canSend =
      this.failure === undefined && !this.cancelling && this.socket.writable;
    if (canSend) {
      this.cancelling = true;
      try {
        this.socket.write(encodeCancel(), () => this.socket.destroy());
        this.socket.end();
      } catch {
        this.cancelling = false;
        this.socket.destroy();
      }
    }
    this.fail(err ?? new Error("The connection was closed by the client"));
    if (!canSend) {
      this.socket.destroy();
    }
  }

  destroy(err?: Error): void {
    this.fail(err ?? new Error("The connection was closed by the client"));
    if (!this.cancelling) {
      this.socket.destroy();
    }
  }

  private fail(err: Error): void {
    if (this.failure !== undefined) return;
    this.failure = err;
    this.paused = false;
    this.cancelIdleTimer();
    const handler = this.handler;
    this.handler = undefined;
    const onClose = this.closeListener;
    this.closeListener = undefined;
    handler?.error(err);
    onClose?.();
  }

  private onData(chunk: Buffer): void {
    if (this.failure !== undefined) return;
    if (this.buffered === 0) {
      this.chunk = chunk;
    } else {
      if (this.chunk !== undefined) {
        this.collected.append(this.chunk);
        this.chunk = undefined;
      }
      this.collected.append(chunk);
    }
    this.buffered += chunk.length;
    this.schedule();
  }

  private schedule(): void {
    if (this.paused || this.failure !== undefined) return;
    if (this.buffered < this.needed) return;
    if (this.eager || this.buffered >= this.retryAt) {
      this.parse();
    } else if (this.idleTimer === undefined) {
      const buffered = this.buffered;
      const onIdle = () => {
        this.idleTimer = undefined;
        if (this.paused || this.failure !== undefined) return;
        if (this.buffered === buffered || this.buffered >= this.retryAt) {
          // No new data for a while (or enough data): try now.
          this.idleDelay =
            this.idleDelay === 0 ? 1 : Math.min(this.idleDelay * 2, 50);
          this.parse();
        } else {
          // More data came: wait for the next pause.
          this.schedule();
        }
      };
      this.idleTimer =
        this.idleDelay === 0
          ? { immediate: setImmediate(onIdle) }
          : { timeout: setTimeout(onIdle, this.idleDelay) };
    }
  }

  private cancelIdleTimer(): void {
    const timer = this.idleTimer;
    if (timer === undefined) return;
    this.idleTimer = undefined;
    if ("immediate" in timer) clearImmediate(timer.immediate);
    else clearTimeout(timer.timeout);
  }

  private parse(): void {
    if (this.paused || this.failure !== undefined) return;
    this.cancelIdleTimer();
    const buf = this.chunk ?? this.collected.view();
    let pos = 0;
    while (pos < buf.length && !this.paused) {
      const handler = this.handler;
      if (handler === undefined) {
        // The server sent a packet without a request (for example, after a
        // cancelled request). The state of the connection is not known.
        this.destroy(new Error("Unexpected data from the ClickHouse server"));
        return;
      }
      const reader = new BinaryReader(buf, pos);
      let packet: ServerPacket;
      try {
        packet = readServerPacket(reader, this.protocolRevision, this.ctx);
      } catch (err) {
        if (err instanceof NeedMoreData) {
          if (err.consumed > pos) {
            pos = err.consumed;
          }
          const remaining = buf.length - pos;
          this.retryAt = remaining * 2;
          this.needed = err.needed - pos;
          this.eager =
            err.firm ||
            this.needed - remaining >= Math.max(EAGER_BYTES, remaining / 8);
          break;
        }
        this.destroy(err as Error);
        return;
      }
      pos = reader.pos;
      this.retryAt = 0;
      this.needed = 0;
      this.eager = false;
      this.idleDelay = 0;
      if (packet.type === "timezone_update") {
        // The session time zone changed (`SET session_timezone`).
        this.server.timezone = packet.timezone;
        this.ctx.timezone = packet.timezone;
      }
      try {
        handler.packet(packet);
      } catch (err) {
        // The request cannot continue (for example, the client cannot write
        // a value). The rest of its packets would come to no request.
        this.destroy(err as Error);
        return;
      }
      if (this.failure !== undefined) return;
    }
    if (this.chunk !== undefined) {
      this.chunk = pos < buf.length ? buf.subarray(pos) : undefined;
    } else {
      this.collected.consume(pos);
    }
    this.buffered = buf.length - pos;
  }
}

/** The smallest number of more bytes for which the socket parses again as
 *  soon as it has them (see `eager`). */
const EAGER_BYTES = 4096;

function openSocket(
  options: NativeSocketOptions,
  signal: AbortSignal,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let socket: net.Socket;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      socket.removeListener("connect", connected);
      socket.removeListener("secureConnect", connected);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
      socket.removeListener("timeout", onTimeout);
      socket.setTimeout(0);
    };
    const onError = (err: unknown) => {
      cleanup();
      socket.destroy();
      reject(err);
    };
    const onAbort = () => onError(signal.reason);
    const onClose = () =>
      onError(new Error("The socket closed before connecting"));
    const onTimeout = () =>
      onError(
        new Error(
          `Timeout error: cannot connect to ${options.host}:${options.port} in ${options.connect_timeout} ms`,
        ),
      );
    const connected = () => {
      cleanup();
      resolve(socket);
    };
    if (options.secure) {
      socket = tls.connect({
        host: options.host,
        port: options.port,
        servername: net.isIP(options.host) ? undefined : options.host,
        ca: options.tls?.ca_cert,
        cert: options.tls?.type === "Mutual" ? options.tls.cert : undefined,
        key: options.tls?.type === "Mutual" ? options.tls.key : undefined,
      });
      socket.once("secureConnect", connected);
    } else {
      socket = net.connect({ host: options.host, port: options.port });
      socket.once("connect", connected);
    }
    socket.setNoDelay(true);
    socket.setKeepAlive(true);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    socket.setTimeout(options.connect_timeout, onTimeout);
  });
}

function handshake(
  socket: net.Socket,
  options: NativeSocketOptions,
  signal: AbortSignal,
): Promise<ServerInfo> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let buf = Buffer.alloc(0);
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
      socket.removeListener("timeout", onTimeout);
      socket.setTimeout(0);
    };
    const onTimeout = () =>
      onError(new Error("Timeout error: no Hello from the ClickHouse server"));
    const onError = (err: unknown) => {
      cleanup();
      reject(err);
    };
    const onAbort = () => onError(signal.reason);
    const onClose = () =>
      onError(
        new Error("The server closed the connection during the handshake"),
      );
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const reader = new BinaryReader(buf);
      let packet: ServerPacket;
      try {
        packet = readServerPacket(reader, CLIENT_REVISION, { timezone: "UTC" });
      } catch (err) {
        if (err instanceof NeedMoreData) return;
        onError(err as Error);
        return;
      }
      cleanup();
      if (reader.pos !== buf.length) {
        // The data that follows the handshake belongs to no request.
        socket.unshift(buf.subarray(reader.pos));
      }
      if (packet.type === "exception") {
        reject(toClickHouseError(packet.exception));
      } else if (packet.type !== "hello") {
        reject(new Error(`Unexpected packet ${packet.type} instead of Hello`));
      } else if (packet.info.revision < MIN_SERVER_REVISION) {
        reject(
          new Error(
            `The ClickHouse server is too old: protocol revision ${packet.info.revision}, ` +
              `the client needs ${MIN_SERVER_REVISION} or newer`,
          ),
        );
      } else {
        socket.write(encodeAddendum(packet.info.protocol_revision));
        resolve(packet.info);
      }
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
    socket.setTimeout(options.connect_timeout, onTimeout);
    try {
      socket.write(
        encodeHello(
          options.client,
          options.database,
          options.username,
          options.password,
        ),
      );
    } catch (err) {
      onError(err as Error);
    }
  });
}
