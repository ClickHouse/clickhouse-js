export interface SelectResult<T> {
  data: T[]
  statistics: { bytes_read: number; elapsed: number; rows_read: number }
  rows: number
  meta: { name: string; type: string }[]
}
