export default () => {
  process.on('unhandledRejection', (err) => console.log(err))
  process.on('uncaughtException', (err) => console.log(err))
  return 42
}
