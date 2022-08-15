// string.replaceAll supported in nodejs v15+
export function replaceAll(
  input: string,
  replace_char: string,
  new_char: string
): string {
  return input.split(replace_char).join(new_char)
}
