import type { ClickHouseClient } from '@clickhouse/client'
import { createClient } from '@clickhouse/client'

class Clickhouse {
  client: ClickHouseClient
  constructor(config: {
    host: string
    user: string
    password: string
    database: string
    port?: number
  }) {
    const protocol = 'http'
    const url = `${protocol}://${config.host}:${config.port || 8123}`

    this.client = createClient({
      host: url,
      username: config.user,
      password: config.password,
      database: config.database,
      request_timeout: 10_000,
      keep_alive: {
        retry_on_expired_socket: true,
        socket_ttl: 2900,
      },
    })
  }

  async query(sql: string) {
    const dataSet = await this.client.query({
      query: sql,
      format: 'JSONEachRow',
    })

    const data = []
    for await (const rows of dataSet.stream()) {
      for (let i = 0; i < rows.length; i++) {
        data.push(rows[i].json())
      }
    }

    return data
  }

  async close() {
    await this.client.close()
  }
}

process.on('uncaughtException', (err) => logAndQuit(err))
process.on('unhandledRejection', (err) => logAndQuit(err))

function logAndQuit(err: unknown) {
  console.error(err)
  process.exit(1)
}

export function randomStr() {
  return Math.random().toString(36).slice(2)
}

export function randomArray<T>(size: number, generator: () => T): T[] {
  return [...Array(size).keys()].map(() => generator())
}

const program = async () => {
  const client = new Clickhouse({
    host: 'localhost',
    user: 'default',
    password: '',
    database: 'default',
  })

  setInterval(function () {
    console.log('timer that keeps nodejs processing running')
  }, 1000 * 60 * 60)

  const res1 = await client.query('SELECT * FROM system.numbers LIMIT 500000')
  console.log(`RES1: ${res1.length}`)
  console.log('foo')
  let n = 2
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const cpuIntensiveStuff = randomArray(8_000_000 + n, randomStr)
    console.log(`Size of random stuff: ${cpuIntensiveStuff.length}`)
    const resN = await client.query(
      `SELECT * FROM system.numbers LIMIT ${1500000 + n}`
    )
    console.log(`RES${n++}: ${resN.length}`)
    if (n > 1000) {
      break
    }
  }
  await client.close()
}

void program()
