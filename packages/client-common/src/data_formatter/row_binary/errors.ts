const HeaderDecodingError = 'HEADER_DECODING_ERROR' as const

export class ClickHouseRowBinaryError extends Error {
  readonly args: Record<string, unknown>
  constructor({ message, args }: ClickHouseRowBinaryError) {
    super(message)
    this.args = args

    // Set the prototype explicitly, see:
    // https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, ClickHouseRowBinaryError.prototype)
  }
  static headerDecodingError(
    message: string,
    args?: Record<string, unknown>
  ): ClickHouseRowBinaryError {
    return new ClickHouseRowBinaryError({
      name: HeaderDecodingError,
      args: args ?? {},
      message,
    })
  }
  static decoderNotFoundError(
    col: Record<string, unknown>
  ): ClickHouseRowBinaryError {
    return new ClickHouseRowBinaryError({
      name: HeaderDecodingError,
      message: 'Could find a suitable decoder for this column',
      args: { col },
    })
  }
}
