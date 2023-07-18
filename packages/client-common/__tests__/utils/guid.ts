import * as uuid from 'uuid'

export function guid(): string {
  return uuid.v4().replace(/-/g, '')
}

export function randomUUID(): string {
  return uuid.v4()
}

export function validateUUID(s: string): boolean {
  return uuid.validate(s)
}
