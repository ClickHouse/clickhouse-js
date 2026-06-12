export function add(a: number, b: number): number {
  return a + b
}

export async function asyncDouble(value: number): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 1))
  return value * 2
}
