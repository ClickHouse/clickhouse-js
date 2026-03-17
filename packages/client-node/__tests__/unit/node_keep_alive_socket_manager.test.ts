import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { KeepAliveSocketManager } from '../../src/connection/keep_alive_socket_manager'
import type { SocketInfo } from '../../src/connection/keep_alive_socket_manager'
import type * as net from 'net'

function createMockSocket(): net.Socket {
  return {
    destroy: vi.fn(),
  } as unknown as net.Socket
}

describe('KeepAliveSocketManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const connectionId = 'test-connection-id'
  const idleSocketTTL = 5000

  it('should generate unique socket IDs', () => {
    const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
    const id1 = manager.getNewSocketId()
    const id2 = manager.getNewSocketId()
    expect(id1).toBe(`${connectionId}:S:1`)
    expect(id2).toBe(`${connectionId}:S:2`)
    expect(id1).not.toBe(id2)
  })

  it('should return undefined for unknown sockets', () => {
    const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
    const socket = createMockSocket()
    expect(manager.getSocketInfo(socket)).toBeUndefined()
  })

  it('should register a new socket and return SocketInfo', () => {
    const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
    const socket = createMockSocket()
    const socketId = manager.getNewSocketId()

    const info = manager.registerSocket(socket, socketId)

    expect(info.id).toBe(socketId)
    expect(info.usage_count).toBe(1)
    expect(info.idle_timeout_handle).toBeUndefined()
    expect(info.server_keep_alive_timeout_ms).toBeUndefined()

    // Should now be retrievable
    expect(manager.getSocketInfo(socket)).toBe(info)
  })

  it('should handle socket reuse correctly', () => {
    const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
    const socket = createMockSocket()
    const socketId = manager.getNewSocketId()

    const info = manager.registerSocket(socket, socketId)
    expect(info.usage_count).toBe(1)

    // Simulate an idle timeout handle being set
    info.idle_timeout_handle = setTimeout(() => {}, 1000)

    manager.handleSocketReuse(info)
    expect(info.usage_count).toBe(2)
    expect(info.idle_timeout_handle).toBeUndefined()

    manager.handleSocketReuse(info)
    expect(info.usage_count).toBe(3)
  })

  it('should schedule idle socket destruction and destroy socket after TTL', () => {
    const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
    const socket = createMockSocket()
    const socketId = manager.getNewSocketId()
    const onDestroy = vi.fn()

    const info = manager.registerSocket(socket, socketId)
    manager.scheduleIdleSocketDestruction(socket, info, onDestroy)

    expect(info.idle_timeout_handle).toBeDefined()
    expect(socket.destroy).not.toHaveBeenCalled()
    expect(onDestroy).not.toHaveBeenCalled()

    // Advance time past the idle TTL
    vi.advanceTimersByTime(idleSocketTTL)

    expect(socket.destroy).toHaveBeenCalledOnce()
    expect(onDestroy).toHaveBeenCalledOnce()
    // Socket should be removed from known sockets
    expect(manager.getSocketInfo(socket)).toBeUndefined()
  })

  it('should not destroy socket before TTL expires', () => {
    const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
    const socket = createMockSocket()
    const socketId = manager.getNewSocketId()
    const onDestroy = vi.fn()

    const info = manager.registerSocket(socket, socketId)
    manager.scheduleIdleSocketDestruction(socket, info, onDestroy)

    // Advance time to just before TTL
    vi.advanceTimersByTime(idleSocketTTL - 1)

    expect(socket.destroy).not.toHaveBeenCalled()
    expect(onDestroy).not.toHaveBeenCalled()
    expect(manager.getSocketInfo(socket)).toBe(info)
  })

  it('should work without onDestroy callback', () => {
    const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
    const socket = createMockSocket()
    const socketId = manager.getNewSocketId()

    const info = manager.registerSocket(socket, socketId)
    manager.scheduleIdleSocketDestruction(socket, info)

    vi.advanceTimersByTime(idleSocketTTL)

    expect(socket.destroy).toHaveBeenCalledOnce()
    expect(manager.getSocketInfo(socket)).toBeUndefined()
  })

  it('should update server keep-alive timeout', () => {
    const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
    const socket = createMockSocket()
    const socketId = manager.getNewSocketId()

    const info = manager.registerSocket(socket, socketId)
    expect(info.server_keep_alive_timeout_ms).toBeUndefined()

    manager.updateServerKeepAliveTimeout(info, 10_000)
    expect(info.server_keep_alive_timeout_ms).toBe(10_000)
  })

  describe('cleanupIdleTimeout', () => {
    it('should clear the idle timeout handle', () => {
      const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
      const socket = createMockSocket()
      const socketId = manager.getNewSocketId()

      const info = manager.registerSocket(socket, socketId)
      manager.scheduleIdleSocketDestruction(socket, info)

      // cleanup should clear the timeout before it fires
      manager.cleanupIdleTimeout(socket)
      vi.advanceTimersByTime(idleSocketTTL)

      // Socket should NOT be destroyed since timeout was cleared
      expect(socket.destroy).not.toHaveBeenCalled()
    })

    it('should be a no-op for unknown sockets', () => {
      const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
      const socket = createMockSocket()
      // Should not throw
      expect(() => manager.cleanupIdleTimeout(socket)).not.toThrow()
    })

    it('should be a no-op when no idle timeout is set', () => {
      const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
      const socket = createMockSocket()
      const socketId = manager.getNewSocketId()

      manager.registerSocket(socket, socketId)
      // No idle timeout scheduled, should not throw
      expect(() => manager.cleanupIdleTimeout(socket)).not.toThrow()
    })
  })

  describe('shouldWarnAboutTTL', () => {
    it('should return true when idle_socket_ttl > server timeout', () => {
      const manager = new KeepAliveSocketManager(connectionId, 10_000)
      const socket = createMockSocket()

      const info = manager.registerSocket(socket, manager.getNewSocketId())
      manager.updateServerKeepAliveTimeout(info, 5_000)

      expect(manager.shouldWarnAboutTTL(info)).toBe(true)
    })

    it('should return false when idle_socket_ttl <= server timeout', () => {
      const manager = new KeepAliveSocketManager(connectionId, 5_000)
      const socket = createMockSocket()

      const info = manager.registerSocket(socket, manager.getNewSocketId())
      manager.updateServerKeepAliveTimeout(info, 10_000)

      expect(manager.shouldWarnAboutTTL(info)).toBe(false)
    })

    it('should return false when idle_socket_ttl equals server timeout', () => {
      const manager = new KeepAliveSocketManager(connectionId, 5_000)
      const socket = createMockSocket()

      const info = manager.registerSocket(socket, manager.getNewSocketId())
      manager.updateServerKeepAliveTimeout(info, 5_000)

      expect(manager.shouldWarnAboutTTL(info)).toBe(false)
    })

    it('should return false when server timeout is not set', () => {
      const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)
      const socket = createMockSocket()

      const info = manager.registerSocket(socket, manager.getNewSocketId())
      // server_keep_alive_timeout_ms is undefined by default

      expect(manager.shouldWarnAboutTTL(info)).toBe(false)
    })
  })

  it('should return the configured idle socket TTL', () => {
    const manager = new KeepAliveSocketManager(connectionId, 3000)
    expect(manager.getIdleSocketTTL()).toBe(3000)
  })

  it('should track multiple sockets independently', () => {
    const manager = new KeepAliveSocketManager(connectionId, idleSocketTTL)

    const socket1 = createMockSocket()
    const socket2 = createMockSocket()

    const info1 = manager.registerSocket(socket1, manager.getNewSocketId())
    const info2 = manager.registerSocket(socket2, manager.getNewSocketId())

    expect(info1.id).not.toBe(info2.id)
    expect(manager.getSocketInfo(socket1)).toBe(info1)
    expect(manager.getSocketInfo(socket2)).toBe(info2)

    manager.handleSocketReuse(info1)
    expect(info1.usage_count).toBe(2)
    expect(info2.usage_count).toBe(1)
  })
})
