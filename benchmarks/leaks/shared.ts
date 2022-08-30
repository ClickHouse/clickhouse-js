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
  for (const key in mu) {
    const k = key as keyof MemoryUsage
    mu[k] = mu[k] / (1024 * 1024) // Bytes -> Megabytes
  }
  return mu
}

export function logMemoryUsage(mu: MemoryUsage) {
  console.log('-------------------------------------------------------------')
  for (const key in mu) {
    const k = key as keyof MemoryUsage
    console.log(`${k}: ${mu[k].toFixed(2)} MB`)
  }
  console.log('-------------------------------------------------------------')
}

export function logMemoryUsageDiff({
  previous,
  current,
}: {
  previous: MemoryUsage
  current: MemoryUsage
}) {
  for (const key in previous) {
    const k = key as keyof MemoryUsage
    const diff = current[k] - previous[k]
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
  const finalMemoryUsageBeforeGC = getMemoryUsageInMegabytes()
  logMemoryUsage(finalMemoryUsageBeforeGC)
  logMemoryUsageDiff({
    previous: initialMemoryUsage,
    current: finalMemoryUsageBeforeGC,
  })

  if (global.gc) {
    global.gc()
    console.log()
    console.log('=============================================================')
    console.log('Final diff between start and end of the test  (after GC call)')
    console.log('=============================================================')
    const finalMemoryUsageAfterGC = getMemoryUsageInMegabytes()
    logMemoryUsage(finalMemoryUsageAfterGC)
    logMemoryUsageDiff({
      previous: initialMemoryUsage,
      current: finalMemoryUsageAfterGC,
    })
  } else {
    console.log('GC is not exposed. Re-run the test with --expose_gc node flag')
  }
}

export function logMemoryUsageOnIteration({
  currentMemoryUsage,
  iteration,
  prevMemoryUsage,
}: {
  iteration: number
  prevMemoryUsage: MemoryUsage
  currentMemoryUsage: MemoryUsage
}) {
  console.log()
  console.log('=============================================================')
  console.log(`${iteration} iterations`)
  console.log('=============================================================')
  console.log('Current memory usage:')
  logMemoryUsage(currentMemoryUsage)
  logMemoryUsageDiff({
    previous: prevMemoryUsage,
    current: currentMemoryUsage,
  })
}

export function randomStr() {
  return Math.random().toString(36).slice(2)
}

export function randomArray<T>(size: number, generator: () => T): T[] {
  return [...Array(size).keys()].map(() => generator())
}
