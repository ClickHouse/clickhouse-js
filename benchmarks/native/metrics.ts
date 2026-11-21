import { Session } from "node:inspector/promises";
import { PerformanceObserver } from "node:perf_hooks";
import { latencyStats, type LatencyStats } from "../transport/stats";

const MIB = 1024 * 1024;
const KIB = 1024;

export interface ResourceMetrics {
  /** Total Node.js CPU time (user + system) per measured operation, in ms. */
  cpuMsPerOp: number;
  /** User CPU time per measured operation, in ms. */
  cpuUserMsPerOp: number;
  /** System CPU time per measured operation, in ms. */
  cpuSysMsPerOp: number;
  /** Client-side CPU utilization during the measured phase (cpuTotal / wall * 100). */
  cpuPercent: number;
  /** Peak `heapUsed` increase above post-GC baseline during measured runs (MiB). */
  peakHeapMiB: number;
  /** Peak `arrayBuffers` (Buffer) increase above post-GC baseline (MiB). */
  peakBufMiB: number;
  /** Total V8 JS heap bytes allocated per measured operation (including GC'd objects). */
  allocBytesPerOp: number;
  /** Number of GC pauses during the measured phase. */
  gcCount: number;
  /** Total GC pause duration during the measured phase (ms). */
  gcMs: number;
}

export interface MeasuredRun {
  stats: LatencyStats;
  wallMs: number;
  resources: ResourceMetrics;
}

export function maybeGC(): void {
  const g = globalThis as { gc?: () => void };
  g.gc?.();
}

/**
 * Shared inspector session for V8 allocation sampling. Runs in a dedicated
 * pass after timing completes so sampling never perturbs latency/throughput.
 */
export class AllocationSampler {
  private readonly session = new Session();
  private enabled = false;

  async init(): Promise<void> {
    if (this.enabled) return;
    this.session.connect();
    await this.session.post("HeapProfiler.enable");
    this.enabled = true;
  }

  /** Measures total V8 JS heap bytes allocated while running `fn` (including
   *  short-lived objects collected by minor and major GC). */
  async sampleBytes(fn: () => Promise<void>): Promise<number> {
    await this.init();
    maybeGC();
    await this.session.post("HeapProfiler.startSampling", {
      samplingInterval: 16_384,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    try {
      await fn();
    } finally {
      // Stop sampling in finally so the session stays clean even on error.
    }
    const { profile } = await this.session.post("HeapProfiler.stopSampling");
    let total = 0;
    for (const sample of profile.samples) {
      total += sample.size;
    }
    return total;
  }

  close(): void {
    if (!this.enabled) return;
    this.session.disconnect();
    this.enabled = false;
  }
}

/**
 * Runs warmup, a timed phase capturing latency + CPU + peak heap/buffers + GC,
 * and a separate V8 allocation-sampling pass (so profiler overhead never
 * distorts latency or throughput).
 */
export async function measureIterations(options: {
  warmup: number;
  iterations: number;
  /** Number of logical operations per iteration (default: 1). */
  opsPerIteration?: number;
  /** Number of iterations for the separate allocation sampling pass (default: 2). */
  allocIterations?: number;
  sampler: AllocationSampler;
  fn: (iteration: number) => Promise<void>;
}): Promise<MeasuredRun> {
  const { warmup, iterations, sampler, fn } = options;
  const opsPerIter = options.opsPerIteration ?? 1;
  const allocIters = options.allocIterations ?? Math.min(2, iterations);

  for (let i = 0; i < warmup; i++) {
    await fn(-1 - i);
  }

  maybeGC();
  const baseMem = process.memoryUsage();
  let peakHeap = baseMem.heapUsed;
  let peakBuf = baseMem.arrayBuffers;

  let gcCount = 0;
  let gcMs = 0;
  const gcObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      gcCount++;
      gcMs += entry.duration;
    }
  });
  gcObserver.observe({ entryTypes: ["gc"] });

  const durations: number[] = [];
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();

  try {
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn(i);
      durations.push(performance.now() - start);
      const mem = process.memoryUsage();
      if (mem.heapUsed > peakHeap) peakHeap = mem.heapUsed;
      if (mem.arrayBuffers > peakBuf) peakBuf = mem.arrayBuffers;
    }
  } finally {
    gcObserver.disconnect();
  }

  const wallMs = performance.now() - wallStart;
  const cpuDiff = process.cpuUsage(cpuStart);
  const totalOps = iterations * opsPerIter;
  const cpuUserMs = cpuDiff.user / 1000;
  const cpuSysMs = cpuDiff.system / 1000;
  const cpuTotalMs = cpuUserMs + cpuSysMs;

  // Separate allocation-sampling pass (never inside timed wallMs).
  const sampledBytes = await sampler.sampleBytes(async () => {
    for (let i = 0; i < allocIters; i++) {
      await fn(iterations + i);
    }
  });
  const allocBytesPerOp = sampledBytes / (allocIters * opsPerIter);

  return {
    stats: latencyStats(durations),
    wallMs,
    resources: {
      cpuMsPerOp: cpuTotalMs / totalOps,
      cpuUserMsPerOp: cpuUserMs / totalOps,
      cpuSysMsPerOp: cpuSysMs / totalOps,
      cpuPercent: wallMs > 0 ? (cpuTotalMs / wallMs) * 100 : 0,
      peakHeapMiB: Math.max(0, (peakHeap - baseMem.heapUsed) / MIB),
      peakBufMiB: Math.max(0, (peakBuf - baseMem.arrayBuffers) / MIB),
      allocBytesPerOp,
      gcCount,
      gcMs,
    },
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(2)} MiB`;
  if (bytes >= KIB) return `${(bytes / KIB).toFixed(1)} KiB`;
  return `${bytes.toFixed(0)} B`;
}

export function formatMiB(mib: number): string {
  return `${mib.toFixed(1)} MiB`;
}

export function formatCpuMs(value: number): string {
  if (value >= 10) return `${value.toFixed(1)} ms`;
  if (value >= 1) return `${value.toFixed(2)} ms`;
  return `${value.toFixed(3)} ms`;
}

/** Ratio formatting where LOWER is better (CPU time, allocations, memory). */
export function formatReduction(after: number, base: number): string {
  if (base <= 0) return "n/a";
  const ratio = after / base;
  const pct = (ratio - 1) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${ratio.toFixed(2)}x (${sign}${pct.toFixed(1)}%)`;
}
