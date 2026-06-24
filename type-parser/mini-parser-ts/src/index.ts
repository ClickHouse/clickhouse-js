/// Public entry point for the standalone ClickHouse data-type parser.
///
/// A TypeScript port of the C++ `chdt` library: parse a ClickHouse data-type
/// string (the kind sent in the types row of `RowBinaryWithNamesAndTypes`, e.g.
/// `Array(Nullable(UInt64))`, `Tuple(a UInt8, b String)`, `Enum8('a' = 1)`)
/// into a JSON-serializable AST that mirrors the server's `EXPLAIN AST json = 1`
/// data-type subtree (format version 2).

export { parseDataType } from "./parser.js";
export type { ParseError, ParseResult } from "./parser.js";

export { toJSON } from "./json.js";

export { NodeKind, makeNode } from "./ast.js";
export type { Node, EnumValue } from "./ast.js";

export { tokenize, TokenType } from "./lexer.js";
export type { Token } from "./lexer.js";
