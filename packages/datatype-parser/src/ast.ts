/// Minimal, self-contained AST for ClickHouse data-type strings.
///
/// The node shapes mirror the frozen `EXPLAIN AST json = 1` document
/// (format version 2; see ClickHouse `AST.md`) so that JSON produced here is
/// a drop-in match for the data-type subtree the server emits — and a
/// superset of it: `EnumDataType.values` and `TupleDataType.element_names`
/// are carried here as they are in the server (since v2).
///
/// This is a TypeScript port of the C++ `chdt/ast.h`. The C++ side uses a
/// single "fat" struct with a `kind` discriminant and only the fields relevant
/// to that kind populated; we mirror that exactly (rather than a discriminated
/// union) so the parser port stays line-for-line faithful to the original.

/// A plain `const` object rather than a TS `enum`, so the source is erasable
/// and runs under Node's native type-stripping (which rejects `enum`). The
/// companion type below makes `NodeKind` usable as both a value and a type,
/// exactly as the enum was.
export const NodeKind = {
  DataType: "DataType", /// generic type: name + optional argument list
  EnumDataType: "EnumDataType", /// Enum / Enum8 / Enum16 with fully explicit values
  TupleDataType: "TupleDataType", /// Tuple, with optional element names
  NameTypePair: "NameTypePair", /// `name Type` element of a Nested(...)
  Literal: "Literal", /// numeric / string argument (e.g. Decimal(10, 2))
  Function: "Function", /// operator/function argument (e.g. `max_types = 5`)
  Identifier: "Identifier", /// bare identifier argument
} as const;
export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

export interface EnumValue {
  name: string;
  /// int64 in the server; bigint here to avoid precision loss on serialization.
  value: bigint;
}

/// One node type for the whole tree. Only the fields relevant to `kind` are
/// populated; serialization emits exactly the slots the server would.
export interface Node {
  kind: NodeKind;

  /// DataType / EnumDataType / TupleDataType / Function / Identifier / NameTypePair
  name: string;

  /// DataType / TupleDataType / Function argument list (children inlined in JSON).
  arguments: Node[];
  /// DataType only: whether the type carried a parenthesised argument list at
  /// all. `UInt8` omits the `arguments` slot; `Array(...)` emits it (possibly
  /// empty). Tuple/Function always emit their list.
  has_argument_list: boolean;

  /// EnumDataType: explicit `'name' = value` pairs.
  values: EnumValue[];

  /// TupleDataType: element names. Empty => unnamed tuple (slot omitted).
  element_names: string[];

  /// NameTypePair: the element's type.
  data_type: Node | null;

  /// Literal: `value_type` is the Field type id ("UInt64", "Int64",
  /// "Float64", "String"); `value` is the textual value.
  value_type: string;
  value: string;

  /// Function: set for operators such as `equals`.
  is_operator: boolean;

  /// Identifier: populated when the identifier is compound (a.b).
  name_parts: string[];
}

/// Construct a node with all fields defaulted (mirrors the C++ struct's member
/// initializers), so the parser can set only the slots relevant to `kind`.
export function makeNode(kind: NodeKind): Node {
  return {
    kind,
    name: "",
    arguments: [],
    has_argument_list: false,
    values: [],
    element_names: [],
    data_type: null,
    value_type: "",
    value: "",
    is_operator: false,
    name_parts: [],
  };
}
