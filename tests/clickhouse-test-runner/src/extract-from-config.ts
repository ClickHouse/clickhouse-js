export function handleExtractFromConfig(args: string[]): void {
  let key: string | null = null

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined) continue

    if (arg.startsWith('--key=')) {
      key = arg.substring('--key='.length)
      continue
    }
    if (arg === '--key') {
      const next = args[i + 1]
      if (next !== undefined) {
        key = next
        i++
      }
      continue
    }
  }

  if (key === 'listen_host') {
    process.stdout.write('127.0.0.1\n')
  }

  process.exitCode = 0
}
