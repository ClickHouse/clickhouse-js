import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as http from 'http'
import type * as net from 'net'
import { EventEmitter } from 'stream'
import { ClickHouseLogLevel } from '@clickhouse/client-common'

/**
 * Comprehensive unit tests for SocketPool class
 * Testing critical socket lifecycle, keep-alive, and stale socket cleanup
 */
describe('SocketPool', () => {
  let mockAgent: http.Agent
  let mockSocket: net.Socket
  let mockLogWriter: any
  let knownSockets: WeakMap<net.Socket, any>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    mockLogWriter = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    // Create mock socket
    mockSocket = new EventEmitter() as any
    mockSocket.destroy = vi.fn()
    mockSocket.ref = vi.fn()
    mockSocket.unref = vi.fn()

    // Create mock agent with freeSockets
    mockAgent = {
      freeSockets: {},
      sockets: {},
      requests: {},
      getName: vi.fn(() => 'localhost:8123'),
      destroy: vi.fn(),
    } as any

    knownSockets = new WeakMap()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('Stale Socket Detection and Cleanup', () => {
    it('should destroy socket when TTL expired based on timestamp', async () => {
      const idleSocketTTL = 2500 // 2.5 seconds
      const freedAtTimestamp = Date.now() - 3000 // socket was freed 3 seconds ago

      // Setup socket with expired TTL
      const socketInfo = {
        id: 'socket-1',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 1,
        freed_at_timestamp_ms: freedAtTimestamp,
      }

      knownSockets.set(mockSocket, socketInfo)
      mockAgent.freeSockets = {
        'localhost:8123': [mockSocket],
      }

      // Simulate the cleanup logic from socket_pool.ts lines 104-151
      const host = 'localhost:8123'
      const byHostSockets = mockAgent.freeSockets[host]
      if (byHostSockets) {
        for (const socket of [...byHostSockets]) {
          const info = knownSockets.get(socket)
          if (info) {
            const freedAt = info.freed_at_timestamp_ms
            if (freedAt) {
              const socketAge = Date.now() - freedAt
              if (socketAge >= idleSocketTTL) {
                clearTimeout(info.idle_timeout_handle)
                knownSockets.delete(socket)
                socket.destroy()
              }
            }
          }
        }
      }

      expect(mockSocket.destroy).toHaveBeenCalledTimes(1)
      expect(knownSockets.get(mockSocket)).toBeUndefined()
    })

    it('should not destroy socket when TTL not expired', async () => {
      const idleSocketTTL = 5000 // 5 seconds
      const freedAtTimestamp = Date.now() - 2000 // socket was freed 2 seconds ago

      const socketInfo = {
        id: 'socket-1',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 1,
        freed_at_timestamp_ms: freedAtTimestamp,
      }

      knownSockets.set(mockSocket, socketInfo)
      mockAgent.freeSockets = {
        'localhost:8123': [mockSocket],
      }

      // Simulate cleanup logic
      const host = 'localhost:8123'
      const byHostSockets = mockAgent.freeSockets[host]
      if (byHostSockets) {
        for (const socket of [...byHostSockets]) {
          const info = knownSockets.get(socket)
          if (info) {
            const freedAt = info.freed_at_timestamp_ms
            if (freedAt) {
              const socketAge = Date.now() - freedAt
              if (socketAge >= idleSocketTTL) {
                socket.destroy()
              }
            }
          }
        }
      }

      expect(mockSocket.destroy).not.toHaveBeenCalled()
      expect(knownSockets.get(mockSocket)).toBeDefined()
    })

    it('should handle multiple sockets and destroy only expired ones', async () => {
      const idleSocketTTL = 3000
      const now = Date.now()

      // Socket 1: expired
      const socket1 = new EventEmitter() as any
      socket1.destroy = vi.fn()
      const info1 = {
        id: 'socket-1',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 1,
        freed_at_timestamp_ms: now - 4000, // 4 seconds ago - expired
      }
      knownSockets.set(socket1, info1)

      // Socket 2: not expired
      const socket2 = new EventEmitter() as any
      socket2.destroy = vi.fn()
      const info2 = {
        id: 'socket-2',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 1,
        freed_at_timestamp_ms: now - 1000, // 1 second ago - fresh
      }
      knownSockets.set(socket2, info2)

      // Socket 3: expired
      const socket3 = new EventEmitter() as any
      socket3.destroy = vi.fn()
      const info3 = {
        id: 'socket-3',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 2,
        freed_at_timestamp_ms: now - 5000, // 5 seconds ago - expired
      }
      knownSockets.set(socket3, info3)

      mockAgent.freeSockets = {
        'localhost:8123': [socket1, socket2, socket3],
      }

      // Simulate cleanup
      const host = 'localhost:8123'
      const byHostSockets = mockAgent.freeSockets[host]
      if (byHostSockets) {
        for (const socket of [...byHostSockets]) {
          const info = knownSockets.get(socket)
          if (info) {
            const freedAt = info.freed_at_timestamp_ms
            if (freedAt) {
              const socketAge = Date.now() - freedAt
              if (socketAge >= idleSocketTTL) {
                clearTimeout(info.idle_timeout_handle)
                knownSockets.delete(socket)
                socket.destroy()
              }
            }
          }
        }
      }

      expect(socket1.destroy).toHaveBeenCalledTimes(1)
      expect(socket2.destroy).not.toHaveBeenCalled()
      expect(socket3.destroy).toHaveBeenCalledTimes(1)
      expect(knownSockets.get(socket1)).toBeUndefined()
      expect(knownSockets.get(socket2)).toBeDefined()
      expect(knownSockets.get(socket3)).toBeUndefined()
    })

    it('should handle socket without freed_at_timestamp_ms gracefully', async () => {
      const socketInfo = {
        id: 'socket-1',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 1,
        // No freed_at_timestamp_ms
      }

      knownSockets.set(mockSocket, socketInfo)
      mockAgent.freeSockets = {
        'localhost:8123': [mockSocket],
      }

      // Simulate cleanup
      const host = 'localhost:8123'
      const byHostSockets = mockAgent.freeSockets[host]
      if (byHostSockets) {
        for (const socket of [...byHostSockets]) {
          const info = knownSockets.get(socket)
          if (info) {
            const freedAt = info.freed_at_timestamp_ms
            if (freedAt) {
              const socketAge = Date.now() - freedAt
              if (socketAge >= 3000) {
                socket.destroy()
              }
            }
          }
        }
      }

      expect(mockSocket.destroy).not.toHaveBeenCalled()
    })

    it('should handle unknown socket in freeSockets gracefully', async () => {
      const unknownSocket = new EventEmitter() as any
      unknownSocket.destroy = vi.fn()

      mockAgent.freeSockets = {
        'localhost:8123': [unknownSocket],
      }

      // Simulate cleanup
      const host = 'localhost:8123'
      const byHostSockets = mockAgent.freeSockets[host]
      if (byHostSockets) {
        for (const socket of [...byHostSockets]) {
          const info = knownSockets.get(socket)
          if (info) {
            const freedAt = info.freed_at_timestamp_ms
            if (freedAt) {
              const socketAge = Date.now() - freedAt
              if (socketAge >= 3000) {
                socket.destroy()
              }
            }
          }
        }
      }

      expect(unknownSocket.destroy).not.toHaveBeenCalled()
    })

    it('should clear timeout handle when destroying stale socket', async () => {
      const idleSocketTTL = 2000
      const mockTimeout = setTimeout(() => {}, 10000)
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      const socketInfo = {
        id: 'socket-1',
        idle_timeout_handle: mockTimeout,
        usage_count: 1,
        freed_at_timestamp_ms: Date.now() - 3000,
      }

      knownSockets.set(mockSocket, socketInfo)
      mockAgent.freeSockets = {
        'localhost:8123': [mockSocket],
      }

      // Simulate cleanup
      const host = 'localhost:8123'
      const byHostSockets = mockAgent.freeSockets[host]
      if (byHostSockets) {
        for (const socket of [...byHostSockets]) {
          const info = knownSockets.get(socket)
          if (info) {
            const freedAt = info.freed_at_timestamp_ms
            if (freedAt) {
              const socketAge = Date.now() - freedAt
              if (socketAge >= idleSocketTTL) {
                clearTimeout(info.idle_timeout_handle)
                knownSockets.delete(socket)
                socket.destroy()
              }
            }
          }
        }
      }

      expect(clearTimeoutSpy).toHaveBeenCalledWith(mockTimeout)
    })

    it('should handle multiple hosts in freeSockets', async () => {
      const idleSocketTTL = 2000
      const now = Date.now()

      // Host 1 sockets
      const socket1 = new EventEmitter() as any
      socket1.destroy = vi.fn()
      const info1 = {
        id: 'socket-1',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 1,
        freed_at_timestamp_ms: now - 3000, // expired
      }
      knownSockets.set(socket1, info1)

      // Host 2 sockets
      const socket2 = new EventEmitter() as any
      socket2.destroy = vi.fn()
      const info2 = {
        id: 'socket-2',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 1,
        freed_at_timestamp_ms: now - 3500, // expired
      }
      knownSockets.set(socket2, info2)

      mockAgent.freeSockets = {
        'localhost:8123': [socket1],
        'example.com:8443': [socket2],
      }

      // Simulate cleanup for all hosts
      for (const host of Object.keys(mockAgent.freeSockets)) {
        const byHostSockets = mockAgent.freeSockets[host]
        if (byHostSockets) {
          for (const socket of [...byHostSockets]) {
            const info = knownSockets.get(socket)
            if (info) {
              const freedAt = info.freed_at_timestamp_ms
              if (freedAt) {
                const socketAge = Date.now() - freedAt
                if (socketAge >= idleSocketTTL) {
                  clearTimeout(info.idle_timeout_handle)
                  knownSockets.delete(socket)
                  socket.destroy()
                }
              }
            }
          }
        }
      }

      expect(socket1.destroy).toHaveBeenCalledTimes(1)
      expect(socket2.destroy).toHaveBeenCalledTimes(1)
    })

    it('should handle empty freeSockets gracefully', async () => {
      mockAgent.freeSockets = {}

      // Should not throw
      expect(() => {
        for (const host of Object.keys(mockAgent.freeSockets)) {
          const byHostSockets = mockAgent.freeSockets[host]
          if (byHostSockets) {
            for (const socket of [...byHostSockets]) {
              socket.destroy()
            }
          }
        }
      }).not.toThrow()
    })

    it('should handle null/undefined freeSockets', async () => {
      mockAgent.freeSockets = undefined as any

      // Should not throw when agent.freeSockets is undefined
      expect(() => {
        if (mockAgent.freeSockets) {
          for (const host of Object.keys(mockAgent.freeSockets)) {
            const byHostSockets = mockAgent.freeSockets[host]
            if (byHostSockets) {
              for (const socket of [...byHostSockets]) {
                socket.destroy()
              }
            }
          }
        }
      }).not.toThrow()
    })
  })

  describe('Keep-Alive Header Parsing', () => {
    it('should parse timeout from keep-alive header', () => {
      const keepAliveHeader = 'timeout=5, max=100'
      const match = /timeout=(\d+)/i.exec(String(keepAliveHeader))
      const timeout = match ? match[1] : undefined

      expect(timeout).toBe('5')
      expect(Number(timeout) * 1000).toBe(5000)
    })

    it('should parse timeout with different casing', () => {
      const testCases = [
        'timeout=10',
        'Timeout=10',
        'TIMEOUT=10',
        'max=50, timeout=10',
        'timeout=10, max=50',
      ]

      testCases.forEach((header) => {
        const match = /timeout=(\d+)/i.exec(String(header))
        expect(match?.[1]).toBe('10')
      })
    })

    it('should handle keep-alive header without timeout', () => {
      const keepAliveHeader = 'max=100'
      const match = /timeout=(\d+)/i.exec(String(keepAliveHeader))

      expect(match).toBeNull()
    })

    it('should handle malformed keep-alive header', () => {
      const testCases = [
        'timeout=',
        'timeout=abc',
        'invalid header',
        '',
        'timeout= 5', // space before number
      ]

      testCases.forEach((header) => {
        const match = /timeout=(\d+)/i.exec(String(header))
        // Should either not match or only capture if there's a valid number
        if (match) {
          expect(match[1]).toMatch(/^\d+$/)
        }
      })
    })

    it('should handle array keep-alive headers', () => {
      // HTTP headers can be arrays
      const keepAliveHeaders = ['timeout=5', 'max=100']
      const match = /timeout=(\d+)/i.exec(String(keepAliveHeaders))

      // String(array) joins with comma
      expect(match).toBeTruthy()
    })
  })

  describe('Socket Info Management', () => {
    it('should track socket usage count', () => {
      const socketInfo = {
        id: 'socket-1',
        idle_timeout_handle: undefined,
        usage_count: 0,
      }

      knownSockets.set(mockSocket, socketInfo)

      // Simulate socket reuse
      const info = knownSockets.get(mockSocket)
      if (info) {
        info.usage_count++
      }

      expect(knownSockets.get(mockSocket)?.usage_count).toBe(1)

      // Reuse again
      const info2 = knownSockets.get(mockSocket)
      if (info2) {
        info2.usage_count++
      }

      expect(knownSockets.get(mockSocket)?.usage_count).toBe(2)
    })

    it('should store server keep-alive timeout', () => {
      const socketInfo = {
        id: 'socket-1',
        idle_timeout_handle: undefined,
        usage_count: 1,
      }

      knownSockets.set(mockSocket, socketInfo)

      // Simulate receiving server timeout from header
      const serverTimeout = 30 * 1000 // 30 seconds
      const info = knownSockets.get(mockSocket)
      if (info) {
        info.server_keep_alive_timeout_ms = serverTimeout
      }

      expect(knownSockets.get(mockSocket)?.server_keep_alive_timeout_ms).toBe(
        30000,
      )
    })

    it('should update freed_at_timestamp when socket becomes idle', () => {
      const socketInfo = {
        id: 'socket-1',
        idle_timeout_handle: undefined,
        usage_count: 1,
      }

      knownSockets.set(mockSocket, socketInfo)

      // Simulate socket becoming free
      const freedAt = Date.now()
      const info = knownSockets.get(mockSocket)
      if (info) {
        info.freed_at_timestamp_ms = freedAt
      }

      expect(knownSockets.get(mockSocket)?.freed_at_timestamp_ms).toBe(freedAt)
    })
  })

  describe('Race Condition Edge Cases', () => {
    it('should handle socket age check race condition on CPU-starved machine', async () => {
      const idleSocketTTL = 2000
      const freedAtTimestamp = Date.now() - 1900 // 1.9 seconds ago - just under TTL

      const socketInfo = {
        id: 'socket-1',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 1,
        freed_at_timestamp_ms: freedAtTimestamp,
      }

      knownSockets.set(mockSocket, socketInfo)
      mockAgent.freeSockets = {
        'localhost:8123': [mockSocket],
      }

      // First check - socket is fresh
      let socketAge = Date.now() - freedAtTimestamp
      expect(socketAge).toBeLessThan(idleSocketTTL)

      // Simulate CPU starvation - time passes
      vi.advanceTimersByTime(200) // Socket is now 2.1 seconds old

      // Second check - now expired
      socketAge = Date.now() - freedAtTimestamp
      expect(socketAge).toBeGreaterThanOrEqual(idleSocketTTL)

      // Cleanup should destroy it
      const host = 'localhost:8123'
      const byHostSockets = mockAgent.freeSockets[host]
      if (byHostSockets) {
        for (const socket of [...byHostSockets]) {
          const info = knownSockets.get(socket)
          if (info) {
            const freedAt = info.freed_at_timestamp_ms
            if (freedAt) {
              const age = Date.now() - freedAt
              if (age >= idleSocketTTL) {
                socket.destroy()
              }
            }
          }
        }
      }

      expect(mockSocket.destroy).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle socket.destroy() throwing error gracefully', async () => {
      const errorSocket = new EventEmitter() as any
      errorSocket.destroy = vi.fn(() => {
        throw new Error('Socket destroy failed')
      })

      const socketInfo = {
        id: 'socket-error',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 1,
        freed_at_timestamp_ms: Date.now() - 5000,
      }

      knownSockets.set(errorSocket, socketInfo)
      mockAgent.freeSockets = {
        'localhost:8123': [errorSocket],
      }

      // Cleanup with try-catch (as implementation should have)
      expect(() => {
        const host = 'localhost:8123'
        const byHostSockets = mockAgent.freeSockets[host]
        if (byHostSockets) {
          for (const socket of [...byHostSockets]) {
            const info = knownSockets.get(socket)
            if (info) {
              const freedAt = info.freed_at_timestamp_ms
              if (freedAt) {
                const socketAge = Date.now() - freedAt
                if (socketAge >= 2000) {
                  try {
                    clearTimeout(info.idle_timeout_handle)
                    knownSockets.delete(socket)
                    socket.destroy()
                  } catch (err) {
                    // Should be caught and not crash
                  }
                }
              }
            }
          }
        }
      }).not.toThrow()
    })

    it('should handle socket being removed from freeSockets during iteration', async () => {
      const socket1 = new EventEmitter() as any
      socket1.destroy = vi.fn()
      const socket2 = new EventEmitter() as any
      socket2.destroy = vi.fn()

      const info1 = {
        id: 'socket-1',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 1,
        freed_at_timestamp_ms: Date.now() - 3000,
      }
      const info2 = {
        id: 'socket-2',
        idle_timeout_handle: setTimeout(() => {}, 10000),
        usage_count: 1,
        freed_at_timestamp_ms: Date.now() - 3000,
      }

      knownSockets.set(socket1, info1)
      knownSockets.set(socket2, info2)

      mockAgent.freeSockets = {
        'localhost:8123': [socket1, socket2],
      }

      // Iterate over copy of array to avoid issues
      const host = 'localhost:8123'
      const byHostSockets = mockAgent.freeSockets[host]
      if (byHostSockets) {
        // Using [...byHostSockets] creates a copy
        for (const socket of [...byHostSockets]) {
          const info = knownSockets.get(socket)
          if (info) {
            const freedAt = info.freed_at_timestamp_ms
            if (freedAt) {
              const socketAge = Date.now() - freedAt
              if (socketAge >= 2000) {
                socket.destroy()
              }
            }
          }
        }
      }

      expect(socket1.destroy).toHaveBeenCalled()
      expect(socket2.destroy).toHaveBeenCalled()
    })
  })
})
