#pragma once

/// A small purpose-built tokenizer for ClickHouse data-type strings.
///
/// Type strings use a tiny slice of the SQL grammar — identifiers (bare,
/// backtick- or double-quoted), single-quoted string literals, numbers, and a
/// handful of punctuation tokens. Rather than vendor the full ClickHouse
/// `Lexer` (and its `UTF8Helpers` / `find_symbols` dependencies), this covers
/// exactly that slice, keeping the library free of any ClickHouse headers.

#include <cstddef>
#include <string>
#include <vector>

namespace chdt
{

enum class TokenType
{
    End,           /// end of input
    Word,          /// bare identifier / keyword, e.g. UInt8, Array, SIGNED
    QuotedIdent,   /// `backtick` or "double"-quoted identifier (decoded)
    Number,        /// numeric literal (raw text, no sign)
    String,        /// single-quoted string literal (decoded)
    OpeningParen,  /// (
    ClosingParen,  /// )
    Comma,         /// ,
    Equals,        /// =
    Minus,         /// -
    Dot,           /// .
    Error,         /// malformed token; `text` holds the message
};

struct Token
{
    TokenType type = TokenType::End;
    /// Word/Number: raw source text. QuotedIdent/String: decoded content.
    /// Error: the error message.
    std::string text;
    /// Number only: true when the literal has a fractional part or exponent.
    bool is_float = false;
    /// Byte offset of the token start in the input (for diagnostics).
    size_t begin = 0;
};

/// Tokenize the whole input. The returned vector always ends with an `End`
/// token. A malformed token yields a single trailing `Error` token.
std::vector<Token> tokenize(const std::string & input);

}
