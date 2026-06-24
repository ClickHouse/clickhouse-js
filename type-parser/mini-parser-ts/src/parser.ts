/// A faithful port of ClickHouse's `ParserDataType::parseImpl`
/// (src/Parsers/ParserDataType.cpp) onto the self-contained AST in `ast.ts`.
/// The control flow deliberately tracks the original: identifier + SQL-standard
/// multi-word aliases, the Enum and Tuple special cases, then the generic
/// parametric-argument loop. AggregateFunction/SimpleAggregateFunction and the
/// JSON object-argument syntax are reported as unsupported (see parser.h).
///
/// This is the TypeScript port of the C++ `chdt/parser.cpp`.

import { EnumValue, makeNode, Node, NodeKind } from "./ast.js"
import { Token, tokenize, TokenType } from "./lexer.js"

/// Public entry point types (ported from parser.h).
export interface ParseError {
  message: string /// human-readable description
  position: number /// byte offset into the input where parsing stuck
}

export interface ParseResult {
  ast: Node | null /// non-null on success
  error: ParseError | null /// set on failure
  ok(): boolean
}

function toUpper(s: string): string {
  let r = ""
  for (let i = 0; i < s.length; ++i) {
    const c = s[i] as string
    if (c >= "a" && c <= "z")
      r += String.fromCharCode(c.charCodeAt(0) - "a".charCodeAt(0) + "A".charCodeAt(0))
    else
      r += c
  }
  return r
}

function toLower(s: string): string {
  let r = ""
  for (let i = 0; i < s.length; ++i) {
    const c = s[i] as string
    if (c >= "A" && c <= "Z")
      r += String.fromCharCode(c.charCodeAt(0) - "A".charCodeAt(0) + "a".charCodeAt(0))
    else
      r += c
  }
  return r
}

function isWordCharOrDollar(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$"
}

function isEnumTypeUpper(u: string): boolean {
  return u === "ENUM" || u === "ENUM8" || u === "ENUM16"
}

class Parser {
  private tokens: Token[]
  private pos = 0
  private hard_error: ParseError | null = null

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  run(): ParseResult {
    /// A lexing error surfaces as a trailing Error token.
    for (const tok of this.tokens)
      if (tok.type === TokenType.Error)
        return Parser.fail(tok.begin, tok.text)

    const node = this.parseType()
    if (!node) {
      if (this.hard_error)
        return makeResult(null, this.hard_error)
      return Parser.fail(this.cur().begin, "expected a data type")
    }

    if (this.cur().type !== TokenType.End)
      return Parser.fail(this.cur().begin, "unexpected trailing input after the data type")

    return makeResult(node, null)
  }

  private cur(): Token {
    return this.tokens[this.pos] as Token
  }

  private type(): TokenType {
    return (this.tokens[this.pos] as Token).type
  }

  private advance(): void {
    if ((this.tokens[this.pos] as Token).type !== TokenType.End)
      ++this.pos
  }

  private static fail(at: number, msg: string): ParseResult {
    return makeResult(null, { message: msg, position: at })
  }

  private setHardError(at: number, msg: string): void {
    if (!this.hard_error)
      this.hard_error = { message: msg, position: at }
  }

  private isIdentifier(): boolean {
    return this.type() === TokenType.Word || this.type() === TokenType.QuotedIdent
  }

  /// Consume `count` consecutive Word tokens iff they match `words`
  /// (case-insensitive). Returns the original-cased joined match or "".
  private matchWords(words: string[]): boolean {
    let p = this.pos
    for (const w of words) {
      const tok = this.tokens[p] as Token
      if (tok.type !== TokenType.Word || toUpper(tok.text) !== toUpper(w))
        return false
      ++p
    }
    this.pos = p
    return true
  }

  /// Read a single identifier (bare or quoted) into `name`.
  private parseIdentifier(): { ok: boolean; name: string } {
    if (!this.isIdentifier())
      return { ok: false, name: "" }
    const name = this.cur().text
    this.advance()
    return { ok: true, name }
  }

  private parseType(): Node | null {
    const id = this.parseIdentifier()
    if (!id.ok)
      return null
    let type_name = id.name

    /// Reject quoted garbage that cannot be a type name (e.g. `x.y`, `Null`).
    {
      let allWordChar = true
      for (let i = 0; i < type_name.length; ++i) {
        if (!isWordCharOrDollar(type_name[i] as string)) {
          allWordChar = false
          break
        }
      }
      if (!allWordChar)
        return null
    }

    const type_name_upper = toUpper(type_name)

    /// Keywords that the column-declaration parser claims before the type.
    if (type_name_upper === "NOT" || type_name_upper === "NULL" || type_name_upper === "DEFAULT"
      || type_name_upper === "MATERIALIZED" || type_name_upper === "EPHEMERAL" || type_name_upper === "ALIAS"
      || type_name_upper === "AUTO" || type_name_upper === "PRIMARY" || type_name_upper === "COMMENT"
      || type_name_upper === "CODEC")
      return null

    /// SQL-standard multi-word type names.
    const suffix = this.parseTypeNameSuffix(type_name_upper)
    if (suffix !== "")
      type_name = type_name_upper + " " + suffix

    this.skipTrailingComma()

    /// Enum special case -> EnumDataType with explicit values.
    if (isEnumTypeUpper(type_name_upper) && this.type() === TokenType.OpeningParen) {
      const saved = this.pos
      this.advance()
      const values: EnumValue[] = []
      if (this.parseEnumValues(values) && this.type() === TokenType.ClosingParen) {
        this.advance()
        const node = makeNode(NodeKind.EnumDataType)
        node.name = type_name
        node.values = values
        return node
      }
      this.pos = saved
    }

    /// Tuple special case -> TupleDataType with optional element names.
    if (type_name === "Tuple" && this.type() === TokenType.OpeningParen) {
      const tuple = this.parseTuple(type_name)
      if (tuple)
        return tuple
      /// else: fall through to the generic path
    }

    const node = makeNode(NodeKind.DataType)
    node.name = type_name

    if (this.type() !== TokenType.OpeningParen)
      return node
    this.advance()

    if (!this.parseArgumentList(type_name, node.arguments))
      return null

    if (this.type() !== TokenType.ClosingParen)
      return null
    this.advance()

    node.has_argument_list = true
    return node
  }

  /// Returns the suffix to append for SQL-standard multi-word names, or "".
  private parseTypeNameSuffix(u: string): string {
    if (u === "NATIONAL") {
      if (this.matchWords(["CHARACTER", "LARGE", "OBJECT"])) return "CHARACTER LARGE OBJECT"
      if (this.matchWords(["CHARACTER", "VARYING"])) return "CHARACTER VARYING"
      if (this.matchWords(["CHAR", "VARYING"])) return "CHAR VARYING"
      if (this.matchWords(["CHARACTER"])) return "CHARACTER"
      if (this.matchWords(["CHAR"])) return "CHAR"
    } else if (u === "BINARY" || u === "CHARACTER" || u === "CHAR" || u === "NCHAR") {
      if (this.matchWords(["LARGE", "OBJECT"])) return "LARGE OBJECT"
      if (this.matchWords(["VARYING"])) return "VARYING"
    } else if (u === "DOUBLE") {
      if (this.matchWords(["PRECISION"])) return "PRECISION"
    } else if (u.indexOf("INT") !== -1) {
      /// MySQL-compatible SIGNED / UNSIGNED, optionally after `(width)`.
      if (this.matchWords(["SIGNED"])) return "SIGNED"
      if (this.matchWords(["UNSIGNED"])) return "UNSIGNED"
      if (this.type() === TokenType.OpeningParen) {
        const saved = this.pos
        this.advance()
        if (this.type() === TokenType.Number)
          this.advance()
        if (this.type() === TokenType.ClosingParen) {
          this.advance()
          if (this.matchWords(["SIGNED"])) return "SIGNED"
          if (this.matchWords(["UNSIGNED"])) return "UNSIGNED"
        } else {
          /// not the width form; leave the paren for generic args
          this.pos = saved
        }
      }
    }
    return ""
  }

  /// Skip a trailing comma right before a closing paren: `Tuple(Int, String,)`.
  private skipTrailingComma(): void {
    if (this.type() === TokenType.Comma && (this.tokens[this.pos + 1] as Token).type === TokenType.ClosingParen)
      this.advance()
  }

  /// Explicit-only enum body: 'name' = value, ... . Returns false (caller
  /// restores) for auto-assigned or otherwise non-trivial enums.
  private parseEnumValues(values: EnumValue[]): boolean {
    let first = true
    while (true) {
      if (!first) {
        if (this.type() !== TokenType.Comma)
          break
        this.advance()
      }
      first = false

      if (this.type() !== TokenType.String)
        return false
      const name = this.cur().text
      this.advance()

      if (this.type() !== TokenType.Equals)
        return false
      this.advance()

      let negative = false
      if (this.type() === TokenType.Minus) {
        negative = true
        this.advance()
      }

      if (this.type() !== TokenType.Number || this.cur().is_float)
        return false
      const v = BigInt(this.cur().text)
      this.advance()

      values.push({ name, value: negative ? -v : v })
    }
    return values.length !== 0
  }

  /// Parse a Tuple body into element types + names. Returns null (with the
  /// position restored) if it cannot, so the caller can try the generic path.
  private parseTuple(type_name: string): Node | null {
    const saved = this.pos
    this.advance() /// consume '('

    const node = makeNode(NodeKind.TupleDataType)
    node.name = type_name

    const names: string[] = []
    let has_named = false
    let first = true

    while (true) {
      if (!first) {
        if (this.type() === TokenType.Comma)
          this.advance()
        else
          break
      }
      first = false

      const element_pos = this.pos
      /// Try: identifier Type  (named element)
      const id = this.parseIdentifier()
      if (id.ok) {
        const t = this.parseType()
        if (t) {
          names.push(id.name)
          node.arguments.push(t)
          has_named = true
          continue
        }
      }
      /// Else: just Type  (unnamed element)
      this.pos = element_pos
      const t = this.parseType()
      if (t) {
        names.push("")
        node.arguments.push(t)
      } else {
        break
      }
    }

    if (this.type() === TokenType.ClosingParen && node.arguments.length !== 0) {
      this.advance()
      node.has_argument_list = true
      if (has_named)
        node.element_names = names
      return node
    }

    this.pos = saved
    return null
  }

  /// The generic comma-separated argument list inside `Type(...)`.
  private parseArgumentList(type_name: string, out: Node[]): boolean {
    const lower = toLower(type_name)

    if (type_name === "AggregateFunction" || type_name === "SimpleAggregateFunction") {
      this.setHardError(this.cur().begin, type_name + " is not supported by this parser yet")
      return false
    }
    if (lower === "json") {
      this.setHardError(this.cur().begin, "JSON typed/object arguments are not supported by this parser yet")
      return false
    }

    let arg_num = 0
    while (true) {
      if (arg_num > 0) {
        if (this.type() === TokenType.Comma)
          this.advance()
        else
          break
      }

      let arg: Node | null
      if (type_name === "Dynamic")
        arg = this.parseEqualsArgument()
      else if (type_name === "Nested")
        arg = this.parseNameTypePair()
      else if (type_name === "Tuple")
        arg = this.parseNameTypePairOrType()
      else
        arg = this.parseGenericArgument()

      if (!arg)
        break

      out.push(arg)
      ++arg_num
    }
    return true
  }

  /// `identifier = number` -> Function equals(Identifier, Literal).
  private parseEqualsArgument(): Node | null {
    const id = this.parseIdentifier()
    if (!id.ok)
      return null
    if (this.type() !== TokenType.Equals)
      return null
    this.advance()
    const number = this.parseNumberLiteral()
    if (!number)
      return null

    const idNode = makeNode(NodeKind.Identifier)
    idNode.name = id.name
    const fn = makeNode(NodeKind.Function)
    fn.name = "equals"
    fn.is_operator = true
    fn.arguments = [idNode, number]
    return fn
  }

  /// `name Type` -> NameTypePair (Nested elements).
  private parseNameTypePair(): Node | null {
    const id = this.parseIdentifier()
    if (!id.ok)
      return null
    const t = this.parseType()
    if (!t)
      return null
    const node = makeNode(NodeKind.NameTypePair)
    node.name = id.name
    node.data_type = t
    return node
  }

  private parseNameTypePairOrType(): Node | null {
    const saved = this.pos
    const pair = this.parseNameTypePair()
    if (pair)
      return pair
    this.pos = saved
    return this.parseType()
  }

  /// Generic argument: a scalar literal (optionally `lit = lit`), or a type.
  private parseGenericArgument(): Node | null {
    const lit = this.parseScalarLiteral()
    if (lit) {
      if (this.type() === TokenType.Equals) {
        this.advance()
        const rhs = this.parseScalarLiteral()
        if (!rhs)
          return null
        const fn = makeNode(NodeKind.Function)
        fn.name = "equals"
        fn.is_operator = true
        fn.arguments = [lit, rhs]
        return fn
      }
      return lit
    }
    return this.parseType()
  }

  private parseNumberLiteral(): Node | null {
    let negative = false
    if (this.type() === TokenType.Minus) {
      negative = true
      this.advance()
    }
    if (this.type() !== TokenType.Number)
      return null
    const node = makeNode(NodeKind.Literal)
    node.value_type = this.cur().is_float ? "Float64" : (negative ? "Int64" : "UInt64")
    node.value = (negative ? "-" : "") + this.cur().text
    this.advance()
    return node
  }

  /// A scalar literal: number (optionally signed) or string.
  private parseScalarLiteral(): Node | null {
    if (this.type() === TokenType.Number || this.type() === TokenType.Minus)
      return this.parseNumberLiteral()
    if (this.type() === TokenType.String) {
      const node = makeNode(NodeKind.Literal)
      node.value_type = "String"
      node.value = this.cur().text
      this.advance()
      return node
    }
    return null
  }
}

function makeResult(ast: Node | null, error: ParseError | null): ParseResult {
  return {
    ast,
    error,
    ok(): boolean {
      return this.ast !== null
    },
  }
}

/// Parse the whole string as a single data type. Trailing tokens after a
/// complete type are an error (the entire input must be one type).
export function parseDataType(input: string): ParseResult {
  const parser = new Parser(tokenize(input))
  return parser.run()
}
