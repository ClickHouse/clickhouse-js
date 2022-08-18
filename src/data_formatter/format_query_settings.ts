import { SettingsMap } from '../settings'

export function formatQuerySettings(
  value: number | string | boolean | SettingsMap
): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  // ClickHouse requires a specific, non-JSON format for passing maps
  // as a setting value - single quotes instead of double
  // Example: {'system.numbers':'number != 3'}
  if (value instanceof SettingsMap) {
    return value.toString()
  }
  throw new Error(`Unsupported value in query settings: [${value}].`)
}
