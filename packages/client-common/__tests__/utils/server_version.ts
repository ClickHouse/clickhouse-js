import type { ClickHouseClient } from '@clickhouse/client-common'

interface ServerVersion {
  major: number
  minor: number
}

export async function getServerVersion(
  client: ClickHouseClient,
): Promise<ServerVersion> {
  const rs = await client.query({
    query: `SELECT version() as version`,
    format: 'JSONEachRow',
  })

  // Example result: [ { version: '25.8.1.3994' } ]
  const result = await rs.json<{ version: string }>()
  const firstRow = result[0]
  if (!firstRow) {
    throw new Error(
      `Unable to determine ClickHouse server version, empty result from query`,
    )
  }
  const version = firstRow.version
  if (!version) {
    throw new Error(
      `Unable to determine ClickHouse server version, missing 'version' field in query result: ${JSON.stringify(
        firstRow,
      )}`,
    )
  }
  console.info('Got server version:', version)

  const versionMatch = version.match(/^(\d+)\.(\d+)/)
  if (!versionMatch) {
    throw new Error(
      `Unable to parse ClickHouse server version from string: ${version}`,
    )
  }

  const major = parseInt(versionMatch[1], 10)
  if (isNaN(major)) {
    throw new Error(
      `Unable to parse ClickHouse server major version component from string: ${versionMatch[1]}`,
    )
  }

  const minor = parseInt(versionMatch[2], 10)
  if (isNaN(minor)) {
    throw new Error(
      `Unable to parse ClickHouse server minor version component from string: ${versionMatch[2]}`,
    )
  }

  return {
    major,
    minor,
  }
}

export async function isClickHouseVersionAtLeast(
  client: ClickHouseClient,
  major: number,
  minor: number,
): Promise<boolean> {
  const serverVersion = await getServerVersion(client)

  if (serverVersion.major > major) {
    return true
  }
  return serverVersion.major === major && serverVersion.minor >= minor
}
