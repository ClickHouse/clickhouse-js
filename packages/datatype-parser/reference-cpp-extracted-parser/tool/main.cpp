#include "chdt/parser.h"

#include <iostream>
#include <sstream>
#include <string>

/// chdt-parse: read a ClickHouse data-type string and print its JSON AST.
///
///   chdt-parse "Array(Nullable(UInt64))"     # type from arguments
///   echo "Tuple(a UInt8, b String)" | chdt-parse   # type from stdin
///
/// Prints the JSON AST and exits 0 on success. On a parse error, prints
/// "error: <message> (at byte N)" to stderr and exits 1.
int main(int argc, char ** argv)
{
    std::string input;
    if (argc > 1)
    {
        for (int i = 1; i < argc; ++i)
        {
            if (i > 1)
                input += ' ';
            input += argv[i];
        }
    }
    else
    {
        std::ostringstream ss;
        ss << std::cin.rdbuf();
        input = ss.str();
    }

    /// Trim trailing newline/whitespace from stdin.
    while (!input.empty() && (input.back() == '\n' || input.back() == '\r' || input.back() == ' ' || input.back() == '\t'))
        input.pop_back();

    chdt::ParseResult result = chdt::parseDataType(input);
    if (!result.ok())
    {
        std::cerr << "error: " << result.error->message << " (at byte " << result.error->position << ")\n";
        return 1;
    }

    std::cout << chdt::toJSON(*result.ast) << "\n";
    return 0;
}
