const errorRe =
  /(Code|Error): (?<code>\d+).*Exception: (?<message>.+)\((?<type>(?=.+[A-Z]{3})[A-Z0-9_]+?)\)/s
interface ParsedClickHouseError {
  message: string
  code: string
  type?: string
}

export class ClickHouseError extends Error {
  readonly code: string
  readonly type: string | undefined
  constructor({ message, code, type }: ParsedClickHouseError) {
    super(message)
    this.code = code
    this.type = type

    // Set the prototype explicitly, see:
    // https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, ClickHouseError.prototype)
  }
}

export function parseError(input: string): ClickHouseError | Error {
  const match = input.match(errorRe)
  const groups = match?.groups as ParsedClickHouseError | undefined
  if (groups) {
    return new ClickHouseError(groups)
  } else {
    return new Error(input)
  }
}
