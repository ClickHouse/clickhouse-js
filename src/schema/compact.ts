import { Infer, Shape } from './common';

export function compactJson<S extends Shape>(shape: S, value: Infer<S>) {
  const compacted = [];
  for (const key in shape) {
    if (key in value) {
      compacted.push(value[key]);
    }
  }
  return compacted;
}

export function decompactJson<S extends Shape>(shape: S, [row]: [unknown[]]) {
  const obj: Record<string, unknown> = {};
  let i = 0;
  for (const key in shape) {
    obj[key] = row[i];
    i++;
  }
  return obj as Infer<S>;
}
