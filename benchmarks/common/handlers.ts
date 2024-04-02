export function attachExceptionHandlers() {
  process.on('uncaughtException', (err) => logAndQuit(err))
  process.on('unhandledRejection', (err) => logAndQuit(err))

  function logAndQuit(err: unknown) {
    console.error(err)
    process.exit(1)
  }
}
