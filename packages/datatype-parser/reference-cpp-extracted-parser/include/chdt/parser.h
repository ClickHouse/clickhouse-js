#pragma once

/// Public entry point: parse a ClickHouse data-type string into the AST in
/// `ast.h`. Self-contained — no dependency on the ClickHouse source tree.
///
/// Coverage mirrors the server's `ParserDataType` (`src/Parsers/ParserDataType.cpp`)
/// with two deliberate omissions, deferred for now:
///   * AggregateFunction / SimpleAggregateFunction — would pull in the full
///     function-expression parser; a clear error is returned instead.
///   * the new JSON/Object path-typed arguments (`JSON(a.b UInt32, SKIP x)`).
///     The bare `JSON` type and legacy `Object('json')` parse fine; the
///     object-argument syntax returns an error.
/// Everything else — nested types, parametric types, enums (explicit and
/// auto-assigned), named/unnamed tuples, Nested, Dynamic(max_types=N), and the
/// SQL-standard multi-word aliases — is supported.

#include <optional>
#include <string>

#include "chdt/ast.h"

namespace chdt

{

struct ParseError
{
    std::string message;   /// human-readable description
    size_t position = 0;   /// byte offset into the input where parsing stuck
};

struct ParseResult
{
    NodePtr ast;                       /// non-null on success
    std::optional<ParseError> error;   /// set on failure

    bool ok() const { return ast != nullptr; }
};

/// Parse the whole string as a single data type. Trailing tokens after a
/// complete type are an error (the entire input must be one type).
ParseResult parseDataType(const std::string & input);

}
