import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Measure event-loop delay in the same Node.js process as the ClickHouse client.
 * No ClickHouse server is needed to run this demonstration.
 *
 * Copy the monitor and reporting timer into the affected application and compare
 * their timestamps with client errors. A separate process cannot measure the
 * application's event loop.
 *
 * Samples are in nanoseconds. With a 20 ms resolution, an idle process normally
 * reports values near 20 ms, not zero. Look for spikes above that baseline.
 * With about 50 samples per report, p99 and max will often match.
 */
const delay = monitorEventLoopDelay({ resolution: 20 });
delay.enable();

const reportingTimer = setInterval(() => {
  console.info("[EventLoopDelay]", {
    time: new Date().toISOString(),
    p99_ms: (delay.percentile(99) / 1e6).toFixed(1),
    max_ms: (delay.max / 1e6).toFixed(1),
  });
  // Each report describes the interval since the previous reset.
  delay.reset();
}, 1000);

try {
  // Record a baseline before introducing a delay.
  await sleep(1100);

  // Demonstration only. Do not copy this blocking loop into your application.
  // It simulates synchronous work that prevents timers and socket callbacks
  // from running. The next report should show a spike of roughly 200 ms.
  const blockUntil = performance.now() + 200;
  while (performance.now() < blockUntil) {
    // Intentionally block the event loop.
  }

  // Let the monitor record the delay and then report recovery.
  await sleep(2000);
} finally {
  clearInterval(reportingTimer);
  delay.disable();
}
