// adjusted from https://stackoverflow.com/a/64414875/4575540
export function permutations<T>(
  args: Array<T>,
  n: number,
  prefix: Array<T> = [],
): Array<Array<T>> {
  if (n === 0) {
    return [prefix]
  }
  return args.flatMap((arg, i) =>
    permutations(args.slice(i + 1), n - 1, [...prefix, arg]),
  )
}
