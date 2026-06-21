import { RowBinaryState, advance } from "./core.js";

/**
 * Read an `Enum8`: the value's underlying signed `Int8`. The name<->value map
 * lives in the column's type definition, not the bytes. Two strategies, both
 * better than one shared name-resolving reader:
 *
 * - Keep the number. Carry the raw Int8 through the app and only map it to a
 *   name where a name is actually needed — most hot loops never need it.
 * - Or generate a dedicated reader per enum that bakes its own constant map,
 *   e.g. `readStatusEnum`. A monomorphic reader with a fixed lookup lets the JIT
 *   optimize each enum's decode on its own:
 *
 *     const STATUS = { 1: "active", 2: "closed" } as const;
 *     const readStatusEnum = (s) => STATUS[readInt8(s) as keyof typeof STATUS];
 */
export function readEnum8(state: RowBinaryState): number {
  return state.view.getInt8(advance(state, 1));
}

/**
 * Read an `Enum16`: the value's underlying signed `Int16` (2 bytes). The
 * name<->value map lives in the column's type definition, not the bytes. Prefer
 * keeping the number, or a generated per-enum reader with a baked-in constant
 * map so the JIT can optimize each enum's decode independently.
 */
export function readEnum16(state: RowBinaryState): number {
  return state.view.getInt16(advance(state, 2), true);
}
