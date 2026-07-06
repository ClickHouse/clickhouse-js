cmake_minimum_required(VERSION 3.16)
project(chdt_datatype_parser CXX)

# A self-contained library: no dependency on the ClickHouse source tree.
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# Warning flags are GCC/Clang-specific; guard them so MSVC builds still work.
if(MSVC)
    add_compile_options(/W4)
else()
    add_compile_options(-Wall -Wextra)
endif()

add_library(chdt_datatype_parser
    src/lexer.cpp
    src/parser.cpp
    src/json.cpp
)
target_include_directories(chdt_datatype_parser PUBLIC include)

# CLI: read a data-type string, print its JSON AST. Exit non-zero on error.
add_executable(chdt-parse tool/main.cpp)
target_link_libraries(chdt-parse PRIVATE chdt_datatype_parser)

enable_testing()
add_subdirectory(test)
