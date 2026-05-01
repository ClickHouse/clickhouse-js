import * as avro from 'avsc'
import Path from 'node:path'
import { cwd } from 'node:process'
const userSchema = {
  type: 'record',
  name: 'User',
  fields: [
    { name: 'id', type: 'int' },
    { name: 'name', type: 'string' },
    { name: 'email', type: 'string' },
    { name: 'isActive', type: 'boolean' },
  ],
}
const filePath = Path.resolve(cwd(), './node/resources/data.avro')
const enc = avro.createFileEncoder(filePath, userSchema)
const users = [
  { id: 1001, name: 'Jane Smith', email: 'jane.smith@example.com', isActive: true },
  { id: 1002, name: 'John Doe', email: 'john.doe@unknown.com', isActive: false },
]
for (const u of users) enc.write(u)
await new Promise((res, rej) => { enc.end(() => res()); enc.on('error', rej) })
console.log('wrote', filePath)
