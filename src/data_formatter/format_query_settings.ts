export function formatQuerySettings(value: number | string | boolean): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  throw new Error(`Unsupported value in query settings: [${value}].`);
}
