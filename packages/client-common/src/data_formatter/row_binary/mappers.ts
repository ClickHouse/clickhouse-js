export interface RowBinaryMappers {
  date?: <T>(daysSinceEpoch: number) => T
  date32?: <T>(daysSinceOrBeforeEpoch: number) => T
  datetime?: <T>(secondsSinceEpoch: number, timezone?: string) => T
  datetime64?: <T>(
    secondsSinceOrBeforeEpoch: bigint,
    nanosOfSecond: number,
    timezone?: string,
  ) => T
  /** Decimal types with scale more than 9: Decimal64, Decimal128, Decimal256 */
  decimal?: <T>(whole: bigint, fractional: bigint) => T
  /** Decimal types with scale 9 and less */
  decimal32?: <T>(whole: number, fractional: number) => T
}
export interface RowBinaryResultSetOptions {
  mappers?: RowBinaryMappers
}
