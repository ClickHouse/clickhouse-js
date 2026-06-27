#pragma once

/// Minimal, self-contained AST for ClickHouse data-type strings.
///
/// The node shapes mirror the frozen `EXPLAIN AST json = 1` document
/// (format version 2; see ClickHouse `AST.md`) so that JSON produced here is
/// a drop-in match for the data-type subtree the server emits — and a
/// superset of it: `EnumDataType.values` and `TupleDataType.element_names`
/// are carried here as they are in the server (since v2).
///
/// This header has no dependency on the ClickHouse source tree.

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace chdt
{

enum class NodeKind
{
    DataType,       /// generic type: name + optional argument list
    EnumDataType,   /// Enum / Enum8 / Enum16 with fully explicit values
    TupleDataType,  /// Tuple, with optional element names
    NameTypePair,   /// `name Type` element of a Nested(...)
    Literal,        /// numeric / string argument (e.g. Decimal(10, 2))
    Function,       /// operator/function argument (e.g. `max_types = 5`)
    Identifier,     /// bare identifier argument
};

struct Node;
using NodePtr = std::shared_ptr<Node>;

struct EnumValue
{
    std::string name;
    int64_t value = 0;
};

/// One node type for the whole tree. Only the fields relevant to `kind` are
/// populated; serialization emits exactly the slots the server would.
struct Node
{
    explicit Node(NodeKind kind_) : kind(kind_) {}

    NodeKind kind;

    /// DataType / EnumDataType / TupleDataType / Function / Identifier / NameTypePair
    std::string name;

    /// DataType / TupleDataType / Function argument list (children inlined in JSON).
    std::vector<NodePtr> arguments;
    /// DataType only: whether the type carried a parenthesised argument list at
    /// all. `UInt8` omits the `arguments` slot; `Array(...)` emits it (possibly
    /// empty). Tuple/Function always emit their list.
    bool has_argument_list = false;

    /// EnumDataType: explicit `'name' = value` pairs.
    std::vector<EnumValue> values;

    /// TupleDataType: element names. Empty => unnamed tuple (slot omitted).
    std::vector<std::string> element_names;

    /// NameTypePair: the element's type.
    NodePtr data_type;

    /// Literal: `value_type` is the Field type id ("UInt64", "Int64",
    /// "Float64", "String"); `value` is the textual value.
    std::string value_type;
    std::string value;

    /// Function: set for operators such as `equals`.
    bool is_operator = false;

    /// Identifier: populated when the identifier is compound (a.b).
    std::vector<std::string> name_parts;

    static NodePtr make(NodeKind kind_) { return std::make_shared<Node>(kind_); }
};

/// Serialize a node tree to JSON, matching the server's `formatASTAsJSON`
/// shape for data types. `indent` < 0 produces compact output; >= 0 produces
/// pretty output with that many spaces per level.
std::string toJSON(const Node & node, int indent = 2);

}
