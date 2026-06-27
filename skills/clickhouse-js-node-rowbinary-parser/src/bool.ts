import { Cursor } from "./core.js";
import { readUInt8, writeUInt8 } from "./integers.js";
import { Sink } from "./core.js";

/**
 * Read a `Bool`: 1 byte, stored as `UInt8` (`0` = false, `1` = true). Treats any
 * non-zero byte as true.
 */
export function readBool(state: Cursor): boolean {
  return readUInt8(state) !== 0;
}

/**
 * Write a `Bool`: 1 byte, stored as `UInt8` (`false` -> 0, `true` -> 1). Mirror
 * of {@link readBool}.
 */
export function writeBool(sink: Sink, value: boolean): void {
  writeUInt8(sink, value ? 1 : 0);
}
