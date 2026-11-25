/**
 * Minimal timing/statistics helpers shared by the transport benchmark.
 * Kept dependency-free on purpose so the benchmark can run with a plain
 * `tsc` + `node` invocation (see README.md).
 */

export interface LatencyStats {
  samples: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p99: number;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = (p / 100) * (sortedAsc.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sortedAsc[low];
  const weight = rank - low;
  return sortedAsc[low] * (1 - weight) + sortedAsc[high] * weight;
}

/** Build latency statistics (in milliseconds) from a list of durations. */
export function latencyStats(durationsMs: number[]): LatencyStats {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    samples: sorted.length,
    min: sorted.length ? sorted[0] : 0,
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    mean: sorted.length ? sum / sorted.length : 0,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
  };
}

/** Throughput in mebibytes per second given total bytes and elapsed ms. */
export function throughputMiBs(totalBytes: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return totalBytes / (1024 * 1024) / (elapsedMs / 1000);
}

export function ms(value: number): string {
  return `${value.toFixed(2)} ms`;
}

export function mibs(value: number): string {
  return `${value.toFixed(2)} MiB/s`;
}
