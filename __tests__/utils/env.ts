export function getFromEnv(key: string): string {
  const value = process.env[key]
  if (value === undefined) {
    throw Error(`Environment variable ${key} is not set`)
  }
  return value
}
