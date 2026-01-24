export const EnvKeys = {
  host: 'CLICKHOUSE_CLOUD_HOST',
  username: 'CLICKHOUSE_CLOUD_USERNAME',
  password: 'CLICKHOUSE_CLOUD_PASSWORD',
  jwt_access_token: 'CLICKHOUSE_CLOUD_JWT_ACCESS_TOKEN',
  jwt_secret: 'CLICKHOUSE_CLOUD_JWT_SECRET',
}

export function getFromEnv(key: string): string {
  const value = process.env[key]
  if (value === undefined) {
    throw Error(`Environment variable ${key} is not set`)
  }
  return value
}

export function getAuthFromEnv() {
  if (process.env['CLICKHOUSE_TEST_ENVIRONMENT'] === 'cloud') {
    const username = process.env[EnvKeys.username]
    const password = process.env[EnvKeys.password]
    return { username: username ?? 'default', password: password ?? '' }
  }

  return { username: 'default', password: '' }
}
