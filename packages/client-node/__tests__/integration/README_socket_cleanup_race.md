# Socket Cleanup Race Condition Test

## Overview

The test file `node_socket_cleanup_race.test.ts` reproduces **Issue #4: responseStream Used Before Definition in Cleanup** from the socket handling bug analysis.

## The Bug

### Location

`packages/client-node/src/connection/socket_pool.ts:479`

### Description

The `responseStream` variable is declared at line 216 but not assigned until the `onResponse` callback executes (lines 289 or 291). However, the `cleanup` function (lines 458-493) references `responseStream` at line 479:

```typescript
if (responseStream && !responseStream.readableEnded) {
  log_writer.warn({
    message: `${op}: socket was closed or ended before the response was fully read...`,
    // ...
  })
}
```

The `cleanup` function is registered as a listener for socket 'end' and 'close' events (lines 494-495), which can fire **before** `onResponse` is called if the socket fails early.

### Why This is a Bug

1. **Undefined Variable Access**: When the socket closes before a response arrives, `responseStream` is accessed while still `undefined`
2. **Timing Race Condition**: The bug manifests when socket events fire before HTTP response events
3. **Logic Error**: The code assumes `responseStream` will be defined when cleanup runs, but this isn't guaranteed

### Why It Doesn't Crash

JavaScript's falsy check (`if (responseStream && ...)`) handles `undefined` gracefully:

- `undefined && anything` evaluates to `undefined` (falsy)
- The condition short-circuits and the warning isn't logged

However, this is still a logic bug that could cause issues if:

- The check were written differently (e.g., `if (responseStream !== undefined && !responseStream.readableEnded)`)
- Stricter type checking is applied
- The code is refactored

## Test Strategy

The tests reproduce the race condition by creating scenarios where the socket fails before an HTTP response is received:

### Test 1: Basic Reproduction

Creates a TCP server that immediately destroys the socket upon receiving data, triggering socket cleanup before any response.

### Test 2: Partial Response

Sends partial HTTP headers then ends the connection, ensuring the 'end' event fires before the HTTP parser emits 'response'.

### Test 3: No False Warning

Verifies that no warning about unconsumed streams is logged when `responseStream` is undefined (correct behavior despite the bug).

### Test 4: Event Sequence Verification

Explicitly checks the sequence of logged events to confirm that cleanup executes without a response being received, proving `responseStream` was undefined during the check.

## How to Run

```bash
npm run test:node:integration -- node_socket_cleanup_race
```

## Expected Behavior

All tests should pass. The tests demonstrate that:

1. The code path where `responseStream` is undefined is exercised
2. The cleanup function is called before `onResponse`
3. No crashes occur (due to JavaScript's falsy handling)
4. No false warnings are logged

## Recommended Fix

The cleanup function should explicitly check if `responseStream` is defined:

```typescript
const cleanup = (eventName: string) => () => {
  // ... existing cleanup code ...

  if (log_level <= ClickHouseLogLevel.WARN) {
    // Add explicit undefined check
    if (responseStream !== undefined && !responseStream.readableEnded) {
      log_writer.warn({
        message: `${op}: socket was closed or ended before the response was fully read...`,
        // ...
      })
    }
  }
}
```

This makes the intention explicit and protects against future refactoring issues.
