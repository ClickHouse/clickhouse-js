export interface JSONHandling {
  /**
   * Custom parser for JSON strings
   *
   * @param input stringified JSON
   * @default JSON.parse // See {@link JSON.parse}
   * @returns parsed object
   */
  parse?: <T>(input: string) => T
  /**
   * Custom stringifier for JSON objects
   *
   * @param input any JSON-compatible object
   * @default JSON.stringify // See {@link JSON.stringify}
   * @returns stringified JSON
   */
  stringify?: <T = any>(input: T) => string // T is any because it can LITERALLY be anything
}

/**
 * Internal representation of {@link JSONHandling} where every member is
 * guaranteed to be defined — typically the result of merging a user-supplied
 * partial {@link JSONHandling} with {@link defaultJSONHandling}.
 */
export type ResolvedJSONHandling = Required<JSONHandling>

export const defaultJSONHandling: ResolvedJSONHandling = {
  parse: JSON.parse,
  stringify: JSON.stringify,
}
