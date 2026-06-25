#include "chdt/parser.h"

#include "lexer.h"

#include <algorithm>
#include <array>
#include <cstdlib>
#include <string>

/// A faithful port of ClickHouse's `ParserDataType::parseImpl`
/// (src/Parsers/ParserDataType.cpp) onto the self-contained AST in `ast.h`.
/// The control flow deliberately tracks the original: identifier + SQL-standard
/// multi-word aliases, the Enum and Tuple special cases, then the generic
/// parametric-argument loop. AggregateFunction/SimpleAggregateFunction and the
/// JSON object-argument syntax are reported as unsupported (see parser.h).

namespace chdt
{

namespace
{

std::string toUpper(const std::string & s)
{
    std::string r = s;
    for (char & c : r)
        if (c >= 'a' && c <= 'z')
            c = static_cast<char>(c - 'a' + 'A');
    return r;
}

std::string toLower(const std::string & s)
{
    std::string r = s;
    for (char & c : r)
        if (c >= 'A' && c <= 'Z')
            c = static_cast<char>(c - 'A' + 'a');
    return r;
}

bool isWordCharOrDollar(char c)
{
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '$';
}

bool isEnumTypeUpper(const std::string & u)
{
    return u == "ENUM" || u == "ENUM8" || u == "ENUM16";
}

class Parser
{
public:
    explicit Parser(std::vector<Token> tokens_) : tokens(std::move(tokens_)) {}

    ParseResult run()
    {
        /// A lexing error surfaces as a trailing Error token.
        for (const auto & tok : tokens)
            if (tok.type == TokenType::Error)
                return fail(tok.begin, tok.text);

        NodePtr node = parseType();
        if (!node)
        {
            if (hard_error)
                return ParseResult{nullptr, hard_error};
            return fail(cur().begin, "expected a data type");
        }

        if (cur().type != TokenType::End)
            return fail(cur().begin, "unexpected trailing input after the data type");

        return ParseResult{node, std::nullopt};
    }

private:
    std::vector<Token> tokens;
    size_t pos = 0;
    std::optional<ParseError> hard_error;

    const Token & cur() const { return tokens[pos]; }
    TokenType type() const { return tokens[pos].type; }
    void advance()
    {
        if (tokens[pos].type != TokenType::End)
            ++pos;
    }

    static ParseResult fail(size_t at, const std::string & msg) { return ParseResult{nullptr, ParseError{msg, at}}; }

    void setHardError(size_t at, const std::string & msg)
    {
        if (!hard_error)
            hard_error = ParseError{msg, at};
    }

    bool isIdentifier() const { return type() == TokenType::Word || type() == TokenType::QuotedIdent; }

    /// Consume `count` consecutive Word tokens iff they match `words`
    /// (case-insensitive). Returns the original-cased joined match or "".
    bool matchWords(std::initializer_list<const char *> words)
    {
        size_t p = pos;
        for (const char * w : words)
        {
            if (tokens[p].type != TokenType::Word || toUpper(tokens[p].text) != toUpper(std::string(w)))
                return false;
            ++p;
        }
        pos = p;
        return true;
    }

    /// Read a single identifier (bare or quoted) into `name`.
    bool parseIdentifier(std::string & name)
    {
        if (!isIdentifier())
            return false;
        name = cur().text;
        advance();
        return true;
    }

    NodePtr parseType()
    {
        std::string type_name;
        if (!parseIdentifier(type_name))
            return nullptr;

        /// Reject quoted garbage that cannot be a type name (e.g. `x.y`, `Null`).
        if (!std::all_of(type_name.begin(), type_name.end(), [](char c) { return isWordCharOrDollar(c); }))
            return nullptr;

        const std::string type_name_upper = toUpper(type_name);

        /// Keywords that the column-declaration parser claims before the type.
        if (type_name_upper == "NOT" || type_name_upper == "NULL" || type_name_upper == "DEFAULT"
            || type_name_upper == "MATERIALIZED" || type_name_upper == "EPHEMERAL" || type_name_upper == "ALIAS"
            || type_name_upper == "AUTO" || type_name_upper == "PRIMARY" || type_name_upper == "COMMENT"
            || type_name_upper == "CODEC")
            return nullptr;

        /// SQL-standard multi-word type names.
        std::string suffix = parseTypeNameSuffix(type_name_upper);
        if (!suffix.empty())
            type_name = type_name_upper + " " + suffix;

        skipTrailingComma();

        /// Enum special case -> EnumDataType with explicit values.
        if (isEnumTypeUpper(type_name_upper) && type() == TokenType::OpeningParen)
        {
            size_t saved = pos;
            advance();
            std::vector<EnumValue> values;
            if (parseEnumValues(values) && type() == TokenType::ClosingParen)
            {
                advance();
                auto node = Node::make(NodeKind::EnumDataType);
                node->name = type_name;
                node->values = std::move(values);
                return node;
            }
            pos = saved;
        }

        /// Tuple special case -> TupleDataType with optional element names.
        if (type_name == "Tuple" && type() == TokenType::OpeningParen)
        {
            if (NodePtr tuple = parseTuple(type_name))
                return tuple;
            /// else: fall through to the generic path
        }

        auto node = Node::make(NodeKind::DataType);
        node->name = type_name;

        if (type() != TokenType::OpeningParen)
            return node;
        advance();

        if (!parseArgumentList(type_name, node->arguments))
            return nullptr;

        if (type() != TokenType::ClosingParen)
            return nullptr;
        advance();

        node->has_argument_list = true;
        return node;
    }

    /// Returns the suffix to append for SQL-standard multi-word names, or "".
    std::string parseTypeNameSuffix(const std::string & u)
    {
        if (u == "NATIONAL")
        {
            if (matchWords({"CHARACTER", "LARGE", "OBJECT"})) return "CHARACTER LARGE OBJECT";
            if (matchWords({"CHARACTER", "VARYING"})) return "CHARACTER VARYING";
            if (matchWords({"CHAR", "VARYING"})) return "CHAR VARYING";
            if (matchWords({"CHARACTER"})) return "CHARACTER";
            if (matchWords({"CHAR"})) return "CHAR";
        }
        else if (u == "BINARY" || u == "CHARACTER" || u == "CHAR" || u == "NCHAR")
        {
            if (matchWords({"LARGE", "OBJECT"})) return "LARGE OBJECT";
            if (matchWords({"VARYING"})) return "VARYING";
        }
        else if (u == "DOUBLE")
        {
            if (matchWords({"PRECISION"})) return "PRECISION";
        }
        else if (u.find("INT") != std::string::npos)
        {
            /// MySQL-compatible SIGNED / UNSIGNED, optionally after `(width)`.
            if (matchWords({"SIGNED"})) return "SIGNED";
            if (matchWords({"UNSIGNED"})) return "UNSIGNED";
            if (type() == TokenType::OpeningParen)
            {
                size_t saved = pos;
                advance();
                if (type() == TokenType::Number)
                    advance();
                if (type() == TokenType::ClosingParen)
                {
                    advance();
                    if (matchWords({"SIGNED"})) return "SIGNED";
                    if (matchWords({"UNSIGNED"})) return "UNSIGNED";
                }
                else
                {
                    /// not the width form; leave the paren for generic args
                    pos = saved;
                }
            }
        }
        return "";
    }

    /// Skip a trailing comma right before a closing paren: `Tuple(Int, String,)`.
    void skipTrailingComma()
    {
        if (type() == TokenType::Comma && tokens[pos + 1].type == TokenType::ClosingParen)
            advance();
    }

    /// Explicit-only enum body: 'name' = value, ... . Returns false (caller
    /// restores) for auto-assigned or otherwise non-trivial enums.
    bool parseEnumValues(std::vector<EnumValue> & values)
    {
        bool first = true;
        while (true)
        {
            if (!first)
            {
                if (type() != TokenType::Comma)
                    break;
                advance();
            }
            first = false;

            if (type() != TokenType::String)
                return false;
            std::string name = cur().text;
            advance();

            if (type() != TokenType::Equals)
                return false;
            advance();

            bool negative = false;
            if (type() == TokenType::Minus)
            {
                negative = true;
                advance();
            }

            if (type() != TokenType::Number || cur().is_float)
                return false;
            int64_t v = std::strtoll(cur().text.c_str(), nullptr, 10);
            advance();

            values.push_back(EnumValue{name, negative ? -v : v});
        }
        return !values.empty();
    }

    /// Parse a Tuple body into element types + names. Returns null (with the
    /// position restored) if it cannot, so the caller can try the generic path.
    NodePtr parseTuple(const std::string & type_name)
    {
        size_t saved = pos;
        advance(); /// consume '('

        auto node = Node::make(NodeKind::TupleDataType);
        node->name = type_name;

        std::vector<std::string> names;
        bool has_named = false;
        bool first = true;

        while (true)
        {
            if (!first)
            {
                if (type() == TokenType::Comma)
                    advance();
                else
                    break;
            }
            first = false;

            size_t element_pos = pos;
            std::string ident;
            /// Try: identifier Type  (named element)
            if (parseIdentifier(ident))
            {
                if (NodePtr t = parseType())
                {
                    names.push_back(ident);
                    node->arguments.push_back(t);
                    has_named = true;
                    continue;
                }
            }
            /// Else: just Type  (unnamed element)
            pos = element_pos;
            if (NodePtr t = parseType())
            {
                names.emplace_back("");
                node->arguments.push_back(t);
            }
            else
            {
                break;
            }
        }

        if (type() == TokenType::ClosingParen && !node->arguments.empty())
        {
            advance();
            node->has_argument_list = true;
            if (has_named)
                node->element_names = std::move(names);
            return node;
        }

        pos = saved;
        return nullptr;
    }

    /// The generic comma-separated argument list inside `Type(...)`.
    bool parseArgumentList(const std::string & type_name, std::vector<NodePtr> & out)
    {
        const std::string lower = toLower(type_name);

        if (type_name == "AggregateFunction" || type_name == "SimpleAggregateFunction")
        {
            setHardError(cur().begin, type_name + " is not supported by this parser yet");
            return false;
        }
        if (lower == "json")
        {
            setHardError(cur().begin, "JSON typed/object arguments are not supported by this parser yet");
            return false;
        }

        size_t arg_num = 0;
        while (true)
        {
            if (arg_num > 0)
            {
                if (type() == TokenType::Comma)
                    advance();
                else
                    break;
            }

            NodePtr arg;
            if (type_name == "Dynamic")
                arg = parseEqualsArgument();
            else if (type_name == "Nested")
                arg = parseNameTypePair();
            else if (type_name == "Tuple")
                arg = parseNameTypePairOrType();
            else
                arg = parseGenericArgument();

            if (!arg)
                break;

            out.push_back(arg);
            ++arg_num;
        }
        return true;
    }

    /// `identifier = number` -> Function equals(Identifier, Literal).
    NodePtr parseEqualsArgument()
    {
        std::string ident;
        if (!parseIdentifier(ident))
            return nullptr;
        if (type() != TokenType::Equals)
            return nullptr;
        advance();
        NodePtr number = parseNumberLiteral();
        if (!number)
            return nullptr;

        auto id = Node::make(NodeKind::Identifier);
        id->name = ident;
        auto fn = Node::make(NodeKind::Function);
        fn->name = "equals";
        fn->is_operator = true;
        fn->arguments = {id, number};
        return fn;
    }

    /// `name Type` -> NameTypePair (Nested elements).
    NodePtr parseNameTypePair()
    {
        std::string name;
        if (!parseIdentifier(name))
            return nullptr;
        NodePtr t = parseType();
        if (!t)
            return nullptr;
        auto node = Node::make(NodeKind::NameTypePair);
        node->name = name;
        node->data_type = t;
        return node;
    }

    NodePtr parseNameTypePairOrType()
    {
        size_t saved = pos;
        if (NodePtr pair = parseNameTypePair())
            return pair;
        pos = saved;
        return parseType();
    }

    /// Generic argument: a scalar literal (optionally `lit = lit`), or a type.
    NodePtr parseGenericArgument()
    {
        if (NodePtr lit = parseScalarLiteral())
        {
            if (type() == TokenType::Equals)
            {
                advance();
                NodePtr rhs = parseScalarLiteral();
                if (!rhs)
                    return nullptr;
                auto fn = Node::make(NodeKind::Function);
                fn->name = "equals";
                fn->is_operator = true;
                fn->arguments = {lit, rhs};
                return fn;
            }
            return lit;
        }
        return parseType();
    }

    NodePtr parseNumberLiteral()
    {
        bool negative = false;
        if (type() == TokenType::Minus)
        {
            negative = true;
            advance();
        }
        if (type() != TokenType::Number)
            return nullptr;
        auto node = Node::make(NodeKind::Literal);
        node->value_type = cur().is_float ? "Float64" : (negative ? "Int64" : "UInt64");
        node->value = (negative ? "-" : "") + cur().text;
        advance();
        return node;
    }

    /// A scalar literal: number (optionally signed) or string.
    NodePtr parseScalarLiteral()
    {
        if (type() == TokenType::Number || type() == TokenType::Minus)
            return parseNumberLiteral();
        if (type() == TokenType::String)
        {
            auto node = Node::make(NodeKind::Literal);
            node->value_type = "String";
            node->value = cur().text;
            advance();
            return node;
        }
        return nullptr;
    }
};

} /// namespace

ParseResult parseDataType(const std::string & input)
{
    Parser parser(tokenize(input));
    return parser.run();
}

}
