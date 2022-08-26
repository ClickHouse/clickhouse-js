import { memoryUsage } from 'process'

export function attachExceptionHandlers() {
  process.on('uncaughtException', (err) => logAndQuit(err))
  process.on('unhandledRejection', (err) => logAndQuit(err))

  function logAndQuit(err: unknown) {
    console.error(err)
    process.exit(1)
  }
}

export interface MemoryUsage {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
}

export function getMemoryUsageInMegabytes(): MemoryUsage {
  const mu = memoryUsage()
  console.log('-------------------------------------------------------------')
  for (const key in mu) {
    const k = key as keyof MemoryUsage
    mu[k] = mu[k] / (1024 * 1024) // Bytes -> Megabytes
    console.log(`${k}: ${mu[k].toFixed(2)} megabytes`)
  }
  console.log('-------------------------------------------------------------')
  return mu
}

export function logMemoryUsageDiff({
  prev,
  cur,
}: {
  prev: MemoryUsage
  cur: MemoryUsage
}) {
  console.log('Total diff:')
  for (const key in prev) {
    const k = key as keyof MemoryUsage
    const diff = cur[k] - prev[k]
    console.log(
      `${k}: ${diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)} megabytes`
    )
  }
}
