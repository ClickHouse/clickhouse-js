#include "lexer.h"

namespace chdt
{

namespace
{

bool isSpace(char c)
{
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
}

bool isDigit(char c)
{
    return c >= '0' && c <= '9';
}

bool isWordFirst(char c)
{
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c == '$';
}

bool isWordChar(char c)
{
    return isWordFirst(c) || isDigit(c);
}

/// Decode the body of a quoted token (string literal or quoted identifier).
/// `quote` is the surrounding quote character. Handles C-style backslash
/// escapes and the SQL doubled-quote escape (e.g. '' inside '...'). Mirrors
/// the relevant behaviour of `tryReadQuotedStringWithSQLStyle`.
bool decodeQuoted(const std::string & in, size_t & pos, char quote, std::string & out, std::string & error)
{
    /// pos points at the opening quote.
    ++pos;
    while (pos < in.size())
    {
        char c = in[pos];
        if (c == quote)
        {
            /// Doubled quote -> literal quote.
            if (pos + 1 < in.size() && in[pos + 1] == quote)
            {
                out.push_back(quote);
                pos += 2;
                continue;
            }
            ++pos; /// consume the closing quote
            return true;
        }
        if (c == '\\')
        {
            if (pos + 1 >= in.size())
            {
                error = "unterminated escape in quoted literal";
                return false;
            }
            char e = in[pos + 1];
            switch (e)
            {
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case '0': out.push_back('\0'); break;
                case 'a': out.push_back('\a'); break;
                case 'v': out.push_back('\v'); break;
                /// \\, \', \", \`, and any other char: keep the literal char.
                default: out.push_back(e); break;
            }
            pos += 2;
            continue;
        }
        out.push_back(c);
        ++pos;
    }
    error = "unterminated quoted literal";
    return false;
}

} /// namespace

std::vector<Token> tokenize(const std::string & input)
{
    std::vector<Token> tokens;
    size_t pos = 0;
    const size_t n = input.size();

    auto fail = [&](size_t at, const std::string & msg)
    {
        tokens.push_back(Token{TokenType::Error, msg, false, at});
    };

    while (pos < n)
    {
        char c = input[pos];

        if (isSpace(c))
        {
            ++pos;
            continue;
        }

        const size_t start = pos;

        switch (c)
        {
            case '(': tokens.push_back({TokenType::OpeningParen, "(", false, start}); ++pos; continue;
            case ')': tokens.push_back({TokenType::ClosingParen, ")", false, start}); ++pos; continue;
            case ',': tokens.push_back({TokenType::Comma, ",", false, start}); ++pos; continue;
            case '=': tokens.push_back({TokenType::Equals, "=", false, start}); ++pos; continue;
            case '-': tokens.push_back({TokenType::Minus, "-", false, start}); ++pos; continue;
            default: break;
        }

        /// A dot may start a fractional number (.5) or be a standalone separator.
        if (c == '.' && !(pos + 1 < n && isDigit(input[pos + 1])))
        {
            tokens.push_back({TokenType::Dot, ".", false, start});
            ++pos;
            continue;
        }

        /// Quoted identifiers.
        if (c == '`' || c == '"')
        {
            std::string decoded;
            std::string error;
            if (!decodeQuoted(input, pos, c, decoded, error))
            {
                fail(start, error);
                break;
            }
            tokens.push_back({TokenType::QuotedIdent, decoded, false, start});
            continue;
        }

        /// String literal.
        if (c == '\'')
        {
            std::string decoded;
            std::string error;
            if (!decodeQuoted(input, pos, c, decoded, error))
            {
                fail(start, error);
                break;
            }
            tokens.push_back({TokenType::String, decoded, false, start});
            continue;
        }

        /// Number.
        if (isDigit(c) || c == '.')
        {
            bool is_float = false;
            /// integer part
            while (pos < n && isDigit(input[pos]))
                ++pos;
            /// fraction
            if (pos < n && input[pos] == '.')
            {
                is_float = true;
                ++pos;
                while (pos < n && isDigit(input[pos]))
                    ++pos;
            }
            /// exponent — `e`/`E`, an optional sign, then AT LEAST ONE digit. A bare
            /// exponent like `1e` or `1e+` is malformed and must be rejected: without
            /// this guard it tokenizes as a Number whose raw text (`1e`) is emitted
            /// verbatim into a Float64 Literal's JSON `value`, yielding invalid JSON
            /// (`"value":1e`). Fail loudly here instead.
            if (pos < n && (input[pos] == 'e' || input[pos] == 'E'))
            {
                is_float = true;
                ++pos;
                if (pos < n && (input[pos] == '+' || input[pos] == '-'))
                    ++pos;
                const size_t exp_digits_start = pos;
                while (pos < n && isDigit(input[pos]))
                    ++pos;
                if (pos == exp_digits_start)
                {
                    fail(start, "malformed number: exponent has no digits");
                    break;
                }
            }
            tokens.push_back({TokenType::Number, input.substr(start, pos - start), is_float, start});
            continue;
        }

        /// Bare word / identifier / keyword.
        if (isWordFirst(c))
        {
            while (pos < n && isWordChar(input[pos]))
                ++pos;
            tokens.push_back({TokenType::Word, input.substr(start, pos - start), false, start});
            continue;
        }

        fail(start, std::string("unexpected character '") + c + "'");
        break;
    }

    tokens.push_back({TokenType::End, "", false, pos});
    return tokens;
}

}
