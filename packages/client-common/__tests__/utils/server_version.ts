import type { ClickHouseClient } from '@clickhouse/client-common'

interface ServerVersion {
  major: number
  minor: number
}

let serverVersion: ServerVersion

export async function cacheServerVersion(
  client: ClickHouseClient,
): Promise<void> {
  const rs = await client.query({
    query: `
      WITH cte AS (
        SELECT arraySlice(
                 splitByChar('.', version()),
                 1, 2
               ) AS ver
      )
      SELECT toInt8(ver[1]) AS major,
             toInt8(ver[2]) AS minor
      FROM cte
    `,
    format: 'JSONEachRow',
  })

  const result = await rs.json<{ major: number; minor: number }>()
  serverVersion = result[0]

  if (
    serverVersion === undefined ||
    serverVersion.major === undefined ||
    serverVersion.minor === undefined
  ) {
    throw new Error(
      `Unable to determine ClickHouse server version, got: ${JSON.stringify(result)}`,
    )
  }

  console.info('Got server version:', serverVersion)
}

export function isClickHouseVersionAtLeast(
  major: number,
  minor: number,
): boolean {
  if (serverVersion.major > major) {
    return true
  }
  return serverVersion.major === major && serverVersion.minor >= minor
}
