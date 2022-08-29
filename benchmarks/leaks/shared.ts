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

export function getMemoryUsageInMegabytes(print = true): MemoryUsage {
  const mu = memoryUsage()
  if (print) {
    console.log('-------------------------------------------------------------')
  }
  for (const key in mu) {
    const k = key as keyof MemoryUsage
    mu[k] = mu[k] / (1024 * 1024) // Bytes -> Megabytes
    if (print) {
      console.log(`${k}: ${mu[k].toFixed(2)} MB`)
    }
  }
  if (print) {
    console.log('-------------------------------------------------------------')
  }
  return mu
}

export function logMemoryUsageDiff({
  prev,
  cur,
}: {
  prev: MemoryUsage
  cur: MemoryUsage
}) {
  for (const key in prev) {
    const k = key as keyof MemoryUsage
    const diff = cur[k] - prev[k]
    console.log(
      `${k}: ${diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)} MB`
    )
  }
}

export function logFinalMemoryUsage(initialMemoryUsage: MemoryUsage) {
  console.log()
  console.log('=============================================================')
  console.log('Final diff between start and end of the test (before GC call)')
  console.log('=============================================================')
  logMemoryUsageDiff({
    prev: initialMemoryUsage,
    cur: getMemoryUsageInMegabytes(false),
  })

  if (global.gc) {
    global.gc()
    console.log()
    console.log('=============================================================')
    console.log('Final diff between start and end of the test  (after GC call)')
    console.log('=============================================================')
    logMemoryUsageDiff({
      prev: initialMemoryUsage,
      cur: getMemoryUsageInMegabytes(false),
    })
  } else {
    console.log('GC is not exposed. Re-run the test with --expose_gc node flag')
  }
}
