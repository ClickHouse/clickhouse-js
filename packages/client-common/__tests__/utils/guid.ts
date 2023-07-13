import { v4 as uuid_v4 } from 'uuid'

export function guid() {
  return uuid_v4().replace(/-/g, '')
}
