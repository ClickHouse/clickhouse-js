export interface JSONHandling {
  /**
   * Custom parser for JSON strings
   *
   * @param input stringified JSON
   * @default JSON.parse // See {@link JSON.parse}
   * @returns parsed object
   */
  parse: <T>(input: string) => T
  /**
   * Custom stringifier for JSON objects
   *
   * @param input any JSON-compatible object
   * @default JSON.stringify // See {@link JSON.stringify}
   * @returns stringified JSON
   */
  stringify: <T = any>(input: T) => string // T is any because it can LITERALLY be anything
}

export const defaultJSONHandling: JSONHandling = {
  parse: JSON.parse,
  stringify: JSON.stringify,
}
