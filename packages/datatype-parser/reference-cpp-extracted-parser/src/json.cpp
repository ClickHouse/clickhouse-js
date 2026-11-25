#include "chdt/ast.h"

#include <cstdio>

namespace chdt
{

namespace
{

void escapeTo(std::string & out, const std::string & s)
{
    out.push_back('"');
    for (unsigned char c : s)
    {
        switch (c)
        {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20)
                {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                }
                else
                    out.push_back(static_cast<char>(c));
        }
    }
    out.push_back('"');
}

struct Writer
{
    std::string out;
    int indent; /// spaces per level, or < 0 for compact

    void newlineIndent(int depth)
    {
        if (indent < 0)
            return;
        out.push_back('\n');
        out.append(static_cast<size_t>(indent) * depth, ' ');
    }

    void colon() { out += (indent < 0) ? ":" : ": "; }
};

/// Object emission is inline (each node writes its own members in order).
void writeNode(Writer & w, const Node & node, int depth);

/// Emit `"key": ` prefix; returns whether a leading comma is needed next.
void writeKey(Writer & w, const char * key, bool & first, int depth)
{
    if (!first)
        w.out.push_back(',');
    first = false;
    w.newlineIndent(depth + 1);
    escapeTo(w.out, key);
    w.colon();
}

void writeArray(Writer & w, const std::vector<NodePtr> & items, int depth)
{
    if (items.empty())
    {
        w.out += "[]";
        return;
    }
    w.out.push_back('[');
    bool first = true;
    for (const auto & item : items)
    {
        if (!first)
            w.out.push_back(',');
        first = false;
        w.newlineIndent(depth + 1);
        writeNode(w, *item, depth + 1);
    }
    w.newlineIndent(depth);
    w.out.push_back(']');
}

void writeStringArray(Writer & w, const std::vector<std::string> & items, int depth)
{
    if (items.empty())
    {
        w.out += "[]";
        return;
    }
    w.out.push_back('[');
    bool first = true;
    for (const auto & item : items)
    {
        if (!first)
            w.out.push_back(',');
        first = false;
        w.newlineIndent(depth + 1);
        escapeTo(w.out, item);
    }
    w.newlineIndent(depth);
    w.out.push_back(']');
}

void writeLiteralValue(Writer & w, const Node & node)
{
    /// 64-bit integers are emitted as JSON strings (the server's contract:
    /// values above 2^53 lose precision under JS `JSON.parse`). Float64 is a
    /// JSON number; String is a JSON string.
    if (node.value_type == "Float64")
        w.out += node.value; /// already a valid JSON number
    else if (node.value_type == "String")
        escapeTo(w.out, node.value);
    else /// UInt64 / Int64 / fallback
        escapeTo(w.out, node.value);
}

void writeNode(Writer & w, const Node & node, int depth)
{
    w.out.push_back('{');
    bool first = true;

    auto key = [&](const char * k) { writeKey(w, k, first, depth); };

    switch (node.kind)
    {
        case NodeKind::DataType:
            key("type"); escapeTo(w.out, "DataType");
            key("name"); escapeTo(w.out, node.name);
            if (node.has_argument_list)
            {
                key("arguments");
                writeArray(w, node.arguments, depth + 1);
            }
            break;

        case NodeKind::EnumDataType:
        {
            key("type"); escapeTo(w.out, "EnumDataType");
            key("name"); escapeTo(w.out, node.name);
            key("values");
            if (node.values.empty())
                w.out += "[]";
            else
            {
                w.out.push_back('[');
                bool vfirst = true;
                for (const auto & v : node.values)
                {
                    if (!vfirst)
                        w.out.push_back(',');
                    vfirst = false;
                    w.newlineIndent(depth + 2);
                    w.out.push_back('{');
                    bool mfirst = true;
                    writeKey(w, "name", mfirst, depth + 2);
                    escapeTo(w.out, v.name);
                    writeKey(w, "value", mfirst, depth + 2);
                    w.out += std::to_string(v.value);
                    w.newlineIndent(depth + 2);
                    w.out.push_back('}');
                }
                w.newlineIndent(depth + 1);
                w.out.push_back(']');
            }
            break;
        }

        case NodeKind::TupleDataType:
            key("type"); escapeTo(w.out, "TupleDataType");
            key("name"); escapeTo(w.out, node.name);
            if (node.has_argument_list)
            {
                key("arguments");
                writeArray(w, node.arguments, depth + 1);
            }
            if (!node.element_names.empty())
            {
                key("element_names");
                writeStringArray(w, node.element_names, depth + 1);
            }
            break;

        case NodeKind::NameTypePair:
            key("type"); escapeTo(w.out, "NameTypePair");
            key("name"); escapeTo(w.out, node.name);
            if (node.data_type)
            {
                key("data_type");
                writeNode(w, *node.data_type, depth + 1);
            }
            break;

        case NodeKind::Literal:
            key("type"); escapeTo(w.out, "Literal");
            key("value_type"); escapeTo(w.out, node.value_type);
            key("value"); writeLiteralValue(w, node);
            break;

        case NodeKind::Function:
            key("type"); escapeTo(w.out, "Function");
            key("name"); escapeTo(w.out, node.name);
            if (node.is_operator)
            {
                key("is_operator");
                w.out += "true";
            }
            key("arguments");
            writeArray(w, node.arguments, depth + 1);
            break;

        case NodeKind::Identifier:
            key("type"); escapeTo(w.out, "Identifier");
            key("name"); escapeTo(w.out, node.name);
            if (!node.name_parts.empty())
            {
                key("name_parts");
                writeStringArray(w, node.name_parts, depth + 1);
            }
            break;
    }

    w.newlineIndent(depth);
    w.out.push_back('}');
}

} /// namespace

std::string toJSON(const Node & node, int indent)
{
    Writer w;
    w.indent = indent;
    writeNode(w, node, 0);
    return w.out;
}

}
