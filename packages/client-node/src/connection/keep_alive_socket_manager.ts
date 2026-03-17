import type * as net from 'net'

export interface SocketInfo {
  id: string
  idle_timeout_handle: ReturnType<typeof setTimeout> | undefined
  usage_count: number
  server_keep_alive_timeout_ms?: number
}

/**
 * Manages keep-alive socket lifecycle for Node.js HTTP connections.
 *
 * Responsibilities:
 * - Tracking known sockets via a WeakMap (prevents memory leaks)
 * - Assigning unique IDs to sockets
 * - Scheduling idle socket destruction after a configurable TTL
 * - Clearing idle timeouts when sockets are reused
 * - Tracking server-reported keep-alive timeouts
 */
export class KeepAliveSocketManager {
  private readonly knownSockets = new WeakMap<net.Socket, SocketInfo>()
  private socketCounter = 0

  constructor(
    private readonly connectionId: string,
    private readonly idleSocketTTL: number,
  ) {}

  /** Generate a unique socket ID scoped to this connection. */
  getNewSocketId(): string {
    this.socketCounter += 1
    return `${this.connectionId}:S:${this.socketCounter}`
  }

  /** Get the SocketInfo for a known socket, or undefined if not tracked. */
  getSocketInfo(socket: net.Socket): SocketInfo | undefined {
    return this.knownSockets.get(socket)
  }

  /** Register a brand-new socket with usage_count = 1. */
  registerSocket(socket: net.Socket, id: string): SocketInfo {
    const socketInfo: SocketInfo = {
      id,
      idle_timeout_handle: undefined,
      usage_count: 1,
    }
    this.knownSockets.set(socket, socketInfo)
    return socketInfo
  }

  /** Prepare a known socket for reuse: clear idle timeout, bump usage_count. */
  handleSocketReuse(socketInfo: SocketInfo): void {
    clearTimeout(socketInfo.idle_timeout_handle)
    socketInfo.idle_timeout_handle = undefined
    socketInfo.usage_count++
  }

  /**
   * Schedule the idle socket destruction after the configured TTL.
   * Returns a cleanup callback to cancel the scheduled destruction.
   * The `onDestroy` callback is invoked just before the socket is destroyed.
   */
  scheduleIdleSocketDestruction(
    socket: net.Socket,
    socketInfo: SocketInfo,
    onDestroy?: () => void,
  ): void {
    const handle = setTimeout(() => {
      this.knownSockets.delete(socket)
      socket.destroy()
      onDestroy?.()
    }, this.idleSocketTTL).unref()
    socketInfo.idle_timeout_handle = handle
  }

  /** Update the server-reported keep-alive timeout on a known socket. */
  updateServerKeepAliveTimeout(
    socketInfo: SocketInfo,
    timeoutMs: number,
  ): void {
    socketInfo.server_keep_alive_timeout_ms = timeoutMs
  }

  /**
   * Clean up a possibly dangling idle timeout handle.
   * Should be called on socket 'end' and 'close' events to prevent leaks.
   */
  cleanupIdleTimeout(socket: net.Socket): void {
    const socketInfo = this.knownSockets.get(socket)
    if (socketInfo?.idle_timeout_handle) {
      clearTimeout(socketInfo.idle_timeout_handle)
    }
  }

  /**
   * Check whether the configured idle_socket_ttl exceeds the server's
   * keep-alive timeout, which can cause unexpected ECONNRESET errors.
   */
  shouldWarnAboutTTL(socketInfo: SocketInfo): boolean {
    const serverTimeoutMs = socketInfo.server_keep_alive_timeout_ms
    return serverTimeoutMs !== undefined && this.idleSocketTTL > serverTimeoutMs
  }

  /** The configured idle socket TTL value. */
  getIdleSocketTTL(): number {
    return this.idleSocketTTL
  }
}
