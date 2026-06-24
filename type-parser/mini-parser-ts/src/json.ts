/// Serialize a node tree to JSON, matching the server's `formatASTAsJSON`
/// shape for data types. This is a faithful TypeScript port of the C++
/// `src/json.cpp`. `indent` < 0 produces compact output; >= 0 produces pretty
/// output with that many spaces per level.
///
/// Byte-faithfulness: the C++ `escapeTo` iterates over the `unsigned char`
/// bytes of the input. To match it exactly for multibyte UTF-8 content we
/// accumulate the whole document into a byte buffer (`number[]` of byte
/// values): structural characters are ASCII, strings are encoded to their
/// UTF-8 bytes, and only bytes < 0x20 are special-cased (the ASCII escapes plus
/// the `\u%04x` fallback). All bytes >= 0x20 are pushed through verbatim. At
/// the end we decode the buffer back to a (byte-identical) JS string.

import { NodeKind, type Node } from "./ast.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/// Mutable holder for the C++ `bool &` "first" flag (TS has no reference
/// parameters), threaded through `writeKey`.
interface FirstFlag {
  first: boolean;
}

function escapeTo(out: number[], s: string): void {
  out.push(0x22 /* '"' */);
  for (const c of encoder.encode(s)) {
    switch (c) {
      case 0x22 /* '"' */:
        pushAscii(out, '\\"');
        break;
      case 0x5c /* '\\' */:
        pushAscii(out, "\\\\");
        break;
      case 0x08 /* '\b' */:
        pushAscii(out, "\\b");
        break;
      case 0x0c /* '\f' */:
        pushAscii(out, "\\f");
        break;
      case 0x0a /* '\n' */:
        pushAscii(out, "\\n");
        break;
      case 0x0d /* '\r' */:
        pushAscii(out, "\\r");
        break;
      case 0x09 /* '\t' */:
        pushAscii(out, "\\t");
        break;
      default:
        if (c < 0x20) {
          /// \u%04x — lowercase hex, 4 digits.
          pushAscii(out, "\\u" + c.toString(16).padStart(4, "0"));
        } else {
          out.push(c);
        }
    }
  }
  out.push(0x22 /* '"' */);
}

/// Append the ASCII bytes of `s` (used only for structural/escape text, which
/// is always ASCII).
function pushAscii(out: number[], s: string): void {
  for (let i = 0; i < s.length; i++) {
    out.push(s.charCodeAt(i));
  }
}

class Writer {
  out: number[] = [];
  indent: number; /// spaces per level, or < 0 for compact

  constructor(indent: number) {
    this.indent = indent;
  }

  newlineIndent(depth: number): void {
    if (this.indent < 0) return;
    this.out.push(0x0a /* '\n' */);
    const spaces = this.indent * depth;
    for (let i = 0; i < spaces; i++) {
      this.out.push(0x20 /* ' ' */);
    }
  }

  colon(): void {
    pushAscii(this.out, this.indent < 0 ? ":" : ": ");
  }
}

/// Emit `"key": ` prefix; flips `flag.first` to false (mirrors the C++
/// `bool & first`).
function writeKey(
  w: Writer,
  key: string,
  flag: FirstFlag,
  depth: number,
): void {
  if (!flag.first) w.out.push(0x2c /* ',' */);
  flag.first = false;
  w.newlineIndent(depth + 1);
  escapeTo(w.out, key);
  w.colon();
}

function writeArray(w: Writer, items: Node[], depth: number): void {
  if (items.length === 0) {
    pushAscii(w.out, "[]");
    return;
  }
  w.out.push(0x5b /* '[' */);
  let first = true;
  for (const item of items) {
    if (!first) w.out.push(0x2c /* ',' */);
    first = false;
    w.newlineIndent(depth + 1);
    writeNode(w, item, depth + 1);
  }
  w.newlineIndent(depth);
  w.out.push(0x5d /* ']' */);
}

function writeStringArray(w: Writer, items: string[], depth: number): void {
  if (items.length === 0) {
    pushAscii(w.out, "[]");
    return;
  }
  w.out.push(0x5b /* '[' */);
  let first = true;
  for (const item of items) {
    if (!first) w.out.push(0x2c /* ',' */);
    first = false;
    w.newlineIndent(depth + 1);
    escapeTo(w.out, item);
  }
  w.newlineIndent(depth);
  w.out.push(0x5d /* ']' */);
}

function writeLiteralValue(w: Writer, node: Node): void {
  /// 64-bit integers are emitted as JSON strings (the server's contract:
  /// values above 2^53 lose precision under JS `JSON.parse`). Float64 is a
  /// JSON number; String is a JSON string.
  if (node.value_type === "Float64") {
    pushAscii(w.out, node.value); /// already a valid JSON number
  } else if (node.value_type === "String") {
    escapeTo(w.out, node.value);
  } /// UInt64 / Int64 / fallback
  else {
    escapeTo(w.out, node.value);
  }
}

/// Object emission is inline (each node writes its own members in order).
function writeNode(w: Writer, node: Node, depth: number): void {
  w.out.push(0x7b /* '{' */);
  const flag: FirstFlag = { first: true };

  const key = (k: string): void => writeKey(w, k, flag, depth);

  switch (node.kind) {
    case NodeKind.DataType:
      key("type");
      escapeTo(w.out, "DataType");
      key("name");
      escapeTo(w.out, node.name);
      if (node.has_argument_list) {
        key("arguments");
        writeArray(w, node.arguments, depth + 1);
      }
      break;

    case NodeKind.EnumDataType: {
      key("type");
      escapeTo(w.out, "EnumDataType");
      key("name");
      escapeTo(w.out, node.name);
      key("values");
      if (node.values.length === 0) {
        pushAscii(w.out, "[]");
      } else {
        w.out.push(0x5b /* '[' */);
        let vfirst = true;
        for (const v of node.values) {
          if (!vfirst) w.out.push(0x2c /* ',' */);
          vfirst = false;
          w.newlineIndent(depth + 2);
          w.out.push(0x7b /* '{' */);
          const mflag: FirstFlag = { first: true };
          writeKey(w, "name", mflag, depth + 2);
          escapeTo(w.out, v.name);
          writeKey(w, "value", mflag, depth + 2);
          pushAscii(w.out, v.value.toString());
          w.newlineIndent(depth + 2);
          w.out.push(0x7d /* '}' */);
        }
        w.newlineIndent(depth + 1);
        w.out.push(0x5d /* ']' */);
      }
      break;
    }

    case NodeKind.TupleDataType:
      key("type");
      escapeTo(w.out, "TupleDataType");
      key("name");
      escapeTo(w.out, node.name);
      if (node.has_argument_list) {
        key("arguments");
        writeArray(w, node.arguments, depth + 1);
      }
      if (node.element_names.length > 0) {
        key("element_names");
        writeStringArray(w, node.element_names, depth + 1);
      }
      break;

    case NodeKind.NameTypePair:
      key("type");
      escapeTo(w.out, "NameTypePair");
      key("name");
      escapeTo(w.out, node.name);
      if (node.data_type) {
        key("data_type");
        writeNode(w, node.data_type, depth + 1);
      }
      break;

    case NodeKind.Literal:
      key("type");
      escapeTo(w.out, "Literal");
      key("value_type");
      escapeTo(w.out, node.value_type);
      key("value");
      writeLiteralValue(w, node);
      break;

    case NodeKind.Function:
      key("type");
      escapeTo(w.out, "Function");
      key("name");
      escapeTo(w.out, node.name);
      if (node.is_operator) {
        key("is_operator");
        pushAscii(w.out, "true");
      }
      key("arguments");
      writeArray(w, node.arguments, depth + 1);
      break;

    case NodeKind.Identifier:
      key("type");
      escapeTo(w.out, "Identifier");
      key("name");
      escapeTo(w.out, node.name);
      if (node.name_parts.length > 0) {
        key("name_parts");
        writeStringArray(w, node.name_parts, depth + 1);
      }
      break;
  }

  w.newlineIndent(depth);
  w.out.push(0x7d /* '}' */);
}

export function toJSON(node: Node, indent = 2): string {
  const w = new Writer(indent);
  writeNode(w, node, 0);
  return decoder.decode(Uint8Array.from(w.out));
}
