/**
 * Encodes JS values as Native columns, for INSERT. Each value goes through
 * two steps:
 *
 * 1. {@link normalize} checks the value against the column type and changes
 *    it to the stored form (for example, a date string to a day number).
 * 2. {@link encodeColumn} writes the stored forms in the Native layout.
 */
export type { EncodeContext } from "./encode/errors";
export { InsertValueError, ServerParseNeeded } from "./encode/errors";
export {
  createNormalizer,
  defaultValue,
  normalize,
  stringifyJSON,
  toScaledDecimal,
} from "./encode/normalize";
export { encodeBlock, encodeColumn } from "./encode/block_encode";
