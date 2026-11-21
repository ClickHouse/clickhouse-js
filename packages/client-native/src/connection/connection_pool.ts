import type { ConnectionParams } from "../common/index";
import type { ClientIdentity } from "../protocol/packets";
import type { NativeTLSOptions } from "./native_socket";
import { NativeSocket } from "./native_socket";

export const USER_ABORTED = "The user aborted a request.";
export const CLIENT_CLOSED = "The client is closed";

export interface NativePoolParams {
  url: URL;
  auth: ConnectionParams["auth"];
  database: string;
  max_open_connections: number;
  tls: NativeTLSOptions | undefined;
  connect_timeout: number;
}

/**
 * Pool of native TCP/TLS sockets with bounded concurrency, FIFO waiter queue,
 * immediate idle-socket eviction on close/error, and graceful cancellation.
 */
export class NativeConnectionPool {
  private readonly params: NativePoolParams;
  private readonly client: ClientIdentity;
  private readonly idle: NativeSocket[] = [];
  private readonly waiting: Array<{
    resolve: (socket: NativeSocket) => void;
    reject: (err: Error) => void;
    signal: AbortSignal | undefined;
  }> = [];
  private open = 0;
  private readonly shutdown = new AbortController();
  private readonly sockets = new Set<NativeSocket>();

  constructor(params: NativePoolParams, client: ClientIdentity) {
    this.params = params;
    this.client = client;
  }

  get closed(): boolean {
    return this.shutdown.signal.aborted;
  }

  withShutdown(signal: AbortSignal | undefined): AbortSignal {
    return signal === undefined
      ? this.shutdown.signal
      : AbortSignal.any([this.shutdown.signal, signal]);
  }

  async acquire(signal: AbortSignal | undefined): Promise<NativeSocket> {
    const socket = await this.takeSocket(signal);
    // The signal can abort after the pool gave this request the socket, and
    // before the request listens to the signal. The request has not used the
    // socket: give it to the next request.
    if (signal?.aborted) {
      this.release(socket);
      throw new Error(USER_ABORTED);
    }
    return socket;
  }

  private async takeSocket(
    signal: AbortSignal | undefined,
  ): Promise<NativeSocket> {
    if (this.closed) throw new Error(CLIENT_CLOSED);
    if (signal?.aborted) throw new Error(USER_ABORTED);
    while (this.idle.length > 0) {
      const socket = this.idle.pop()!;
      if (socket.usable) return socket;
      if (this.sockets.delete(socket)) this.open--;
    }
    if (this.open < this.params.max_open_connections) {
      this.open++;
      try {
        return await this.connect(signal);
      } catch (err) {
        this.open--;
        this.wakeWaiter();
        throw err;
      }
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const i = this.waiting.indexOf(waiter);
        if (i >= 0) {
          this.waiting.splice(i, 1);
          reject(new Error(USER_ABORTED));
        }
      };
      const waiter = {
        signal,
        resolve: (socket: NativeSocket) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(socket);
        },
        reject: (err: Error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(err);
        },
      };
      this.waiting.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async connect(
    signal: AbortSignal | undefined,
  ): Promise<NativeSocket> {
    const { url, auth } = this.params;
    if (auth.type !== "Credentials")
      throw new Error("Unsupported authentication");
    const secure = url.protocol === "tcps:";
    const connectSignal = this.withShutdown(signal);
    try {
      const socket = await NativeSocket.connect(
        {
          host: url.hostname.replace(/^\[(.*)\]$/, "$1"),
          port: url.port !== "" ? Number(url.port) : secure ? 9440 : 9000,
          secure,
          tls: this.params.tls,
          connect_timeout: this.params.connect_timeout,
          database: this.params.database,
          username: auth.username,
          password: auth.password,
          client: this.client,
        },
        connectSignal,
      );
      if (connectSignal.aborted) socket.destroy();
      connectSignal.throwIfAborted();
      this.sockets.add(socket);
      socket.onClose(() => this.evict(socket));
      return socket;
    } catch (err) {
      if (this.closed) throw new Error(CLIENT_CLOSED, { cause: err });
      if (signal?.aborted) throw new Error(USER_ABORTED, { cause: err });
      throw err;
    }
  }

  release(socket: NativeSocket): void {
    socket.finish();
    socket.clearTimeout();
    socket.resume();
    if (this.closed || !socket.usable) {
      this.discard(socket);
      return;
    }
    const waiter = this.waiting.shift();
    if (waiter !== undefined) {
      waiter.resolve(socket);
    } else {
      this.idle.push(socket);
    }
  }

  discard(socket: NativeSocket, err?: Error): void {
    const released = this.sockets.delete(socket);
    if (released) this.open--;
    socket.destroy(err);
    if (released) this.wakeWaiter();
  }

  /** Sends `ClientPacket.Cancel` and removes the socket from the pool. */
  cancel(socket: NativeSocket, err?: Error): void {
    const released = this.sockets.delete(socket);
    if (released) this.open--;
    socket.cancel(err);
    if (released) this.wakeWaiter();
  }

  /** Removes a dead idle socket from the pool as soon as it closes. */
  private evict(socket: NativeSocket): void {
    const idx = this.idle.indexOf(socket);
    if (idx >= 0) this.idle.splice(idx, 1);
    if (this.sockets.delete(socket)) {
      this.open--;
      this.wakeWaiter();
    }
  }

  /** A slot is free: open a new connection for the next waiting request. */
  private wakeWaiter(): void {
    if (this.closed || this.open >= this.params.max_open_connections) return;
    const waiter = this.waiting.shift();
    if (waiter === undefined) return;
    this.open++;
    this.connect(waiter.signal).then(waiter.resolve, (err) => {
      this.open--;
      waiter.reject(err);
      this.wakeWaiter();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    const error = new Error(CLIENT_CLOSED);
    this.shutdown.abort(error);
    for (const waiter of this.waiting.splice(0)) {
      waiter.reject(error);
    }
    this.idle.length = 0;
    for (const socket of this.sockets) this.discard(socket, error);
  }
}
