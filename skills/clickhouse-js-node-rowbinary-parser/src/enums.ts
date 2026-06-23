import { Cursor, advance } from "./core.js";

/**
 * Read an `Enum8`: the value's underlying signed `Int8`. The name<->value map
 * lives in the column's type, not the bytes. Two strategies, both better than one
 * shared name-resolving reader:
 *
 * - Keep the number: carry the raw Int8 and map to a name only where needed —
 *   most hot loops never need it.
 * - Or generate a per-enum reader with a baked-in constant map, so the JIT can
 *   monomorphize each enum's decode:
 *
 *     const STATUS = { 1: "active", 2: "closed" } as const;
 *     const readStatusEnum = (s) => STATUS[readInt8(s) as keyof typeof STATUS];
 */
export function readEnum8(state: Cursor): number {
  return state.view.getInt8(advance(state, 1));
}

/**
 * Read an `Enum16`: the value's underlying signed `Int16` (2 bytes). The
 * name<->value map lives in the column's type definition, not the bytes. Prefer
 * keeping the number, or a generated per-enum reader with a baked-in constant
 * map so the JIT can optimize each enum's decode independently.
 */
export function readEnum16(state: Cursor): number {
  return state.view.getInt16(advance(state, 2), true);
}
