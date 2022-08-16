import * as ch from '../../src/schema'
import { Infer, InsertStream } from '../../src/schema'
import { createClient } from '../../src'

export default async () => {
  const client = createClient()

  enum UserRole {
    User = 'User',
    Admin = 'Admin',
  }
  const userSchema = new ch.Schema({
    id: ch.UInt64,
    name: ch.String,
    externalIds: ch.Array(ch.UInt32),
    settings: ch.Map(ch.String, ch.String),
    role: ch.Enum(UserRole),
    registeredAt: ch.DateTime64(3, 'Europe/Amsterdam'),
  })

  type Data = Infer<typeof userSchema.shape>

  const usersTable = new ch.Table(client, {
    name: 'users',
    schema: userSchema,
  })

  const insertStream = new InsertStream<Data>()
  insertStream.add({
    // NB: (U)Int64/128/256 are represented as strings
    // since their max value > Number.MAX_SAFE_INTEGER
    id: '42',
    name: 'foo',
    externalIds: [1, 2],
    settings: { foo: 'bar' },
    role: UserRole.Admin,
    registeredAt: '2021-04-30 08:05:37.123',
  })
  insertStream.complete()
  await usersTable.insert({
    values: insertStream,
  })

  const { asyncGenerator } = await usersTable.select()
  for await (const value of asyncGenerator()) {
    console.log(value.id)
  }
}
