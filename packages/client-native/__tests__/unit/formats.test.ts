import { describe, expect, it } from "vitest";
import {
  DefaultOutputSettings,
  OutputEncoder,
  OutputSettingNames,
  applyOutputSettings,
  readQueryClauses,
  settingsFromQuery,
} from "../../src/formats";
import {
  DecimalValue,
  JSONObjectValue,
  RawJSONValue,
  TypedValue,
} from "../../src/protocol/columns";
import type { Block } from "../../src/protocol/packets";
import { parseColumnType } from "../../src/protocol/types";

function block(columns: Array<[string, string, unknown[]]>): Block {
  return {
    rows: columns[0]?.[2].length ?? 0,
    columns: columns.map(([name, type, values]) => ({
      name,
      type: parseColumnType(type),
      values,
    })),
  };
}

function encode(
  format: ConstructorParameters<typeof OutputEncoder>[0],
  b: Block,
  settings: Record<string, unknown> = {},
): string {
  const encoder = new OutputEncoder(
    format,
    applyOutputSettings(DefaultOutputSettings, settings),
  );
  return (
    encoder.data({
      ...b,
      rows: 0,
      columns: b.columns.map((c) => ({ ...c, values: [] })),
    }) +
    encoder.data(b) +
    encoder.finish({
      elapsed_ns: 1000,
      rows_read: 1,
      bytes_read: 8,
      rows_before_limit_at_least: undefined,
    })
  );
}

describe("[Native] output encoder", () => {
  const sample = block([
    ["u", "UInt64", [1n, 2n]],
    ["s", "String", ['a"b', "c/d"]],
    ["n", "Nullable(Float64)", [null, Number.NaN]],
    [
      "d",
      "Decimal(9, 2)",
      [new DecimalValue(150n, 2), new DecimalValue(-5n, 2)],
    ],
  ]);

  it("writes JSONEachRow", () => {
    expect(encode("JSONEachRow", sample)).toBe(
      '{"u":1,"s":"a\\"b","n":null,"d":1.5}\n{"u":2,"s":"c\\/d","n":null,"d":-0.05}\n',
    );
  });

  it("follows the JSON quoting settings", () => {
    expect(
      encode("JSONEachRow", sample, {
        output_format_json_quote_64bit_integers: "1",
        output_format_json_quote_decimals: 1,
        output_format_json_quote_denormals: true,
        output_format_json_escape_forward_slashes: 0,
      }),
    ).toBe(
      '{"u":"1","s":"a\\"b","n":null,"d":"1.5"}\n{"u":"2","s":"c/d","n":"nan","d":"-0.05"}\n',
    );
  });

  it("writes the JSON document", () => {
    const doc = JSON.parse(encode("JSON", sample));
    expect(doc).toEqual({
      meta: [
        { name: "u", type: "UInt64" },
        { name: "s", type: "String" },
        { name: "n", type: "Nullable(Float64)" },
        { name: "d", type: "Decimal(9, 2)" },
      ],
      data: [
        { u: 1, s: 'a"b', n: null, d: 1.5 },
        { u: 2, s: "c/d", n: null, d: -0.05 },
      ],
      rows: 2,
      statistics: { elapsed: 0.000001, rows_read: 1, bytes_read: 8 },
    });
  });

  it("writes an empty JSON document", () => {
    const encoder = new OutputEncoder("JSON", DefaultOutputSettings);
    const doc = JSON.parse(
      encoder.finish({
        elapsed_ns: 0,
        rows_read: 0,
        bytes_read: 0,
        rows_before_limit_at_least: undefined,
      }),
    );
    expect(doc).toMatchObject({ meta: [], data: [], rows: 0 });
  });

  it("writes TabSeparated and CSV values", () => {
    const b = block([
      ["s", "String", ["a\tb'c"]],
      ["a", "Array(String)", [["x'y"]]],
      ["t", "Tuple(a UInt8, b String)", [[1, "z"]]],
      ["n", "Nullable(String)", [null]],
    ]);
    expect(encode("TabSeparatedWithNames", b)).toBe(
      "s\ta\tt\tn\na\\tb\\'c\t['x\\'y']\t(1,'z')\t\\N\n",
    );
    expect(encode("CSVWithNames", b)).toBe(
      '"s","a","t.a","t.b","n"\n"a\tb\'c","[\'x\\\'y\']",1,"z",\\N\n',
    );
  });

  it("writes Variant and Dynamic values with their types", () => {
    const b = block([
      [
        "v",
        "Dynamic",
        [
          new TypedValue(parseColumnType("Int64"), 5n),
          new TypedValue(parseColumnType("Array(String)"), ["x"]),
          null,
        ],
      ],
    ]);
    expect(encode("JSONEachRow", b)).toBe('{"v":5}\n{"v":["x"]}\n{"v":null}\n');
    expect(encode("JSONStringsEachRow", b)).toBe(
      '{"v":"5"}\n{"v":"[\'x\']"}\n{"v":"ᴺᵁᴸᴸ"}\n',
    );
  });

  it("rejects the formats that it cannot write", () => {
    expect(() => new OutputEncoder("Parquet", DefaultOutputSettings)).toThrow(
      "The Parquet format is not supported by the native protocol client",
    );
  });
});

const STATISTICS =
  ',\n\n\t"statistics":\n\t{\n\t\t"elapsed": 0.000001,\n\t\t"rows_read": 1,\n\t\t"bytes_read": 8\n\t}\n}\n';

function meta(columns: Array<[string, string]>): string {
  return (
    '{\n\t"meta":\n\t[\n' +
    columns
      .map(
        ([name, type]) =>
          `\t\t{\n\t\t\t"name": "${name}",\n\t\t\t"type": "${type}"\n\t\t}`,
      )
      .join(",\n") +
    "\n\t]"
  );
}

/** The text of all formats must be the same, byte for byte, as the text of
 *  the HTTP interface. The expected texts in these tests come from the
 *  server. The integration tests compare the two for more types. */
describe("[Native] output encoder: the layout of the JSON documents", () => {
  const rows = block([
    ["k", "UInt8", [0, 1]],
    ["s", "String", ["a", "b"]],
  ]);
  const rowsMeta = meta([
    ["k", "UInt8"],
    ["s", "String"],
  ]);

  it("writes JSON with one field on each line", () => {
    expect(encode("JSON", rows)).toBe(
      rowsMeta +
        ',\n\n\t"data":\n\t[\n' +
        '\t\t{\n\t\t\t"k": 0,\n\t\t\t"s": "a"\n\t\t},\n' +
        '\t\t{\n\t\t\t"k": 1,\n\t\t\t"s": "b"\n\t\t}\n' +
        '\t],\n\n\t"rows": 2' +
        STATISTICS,
    );
  });

  it("writes JSONStrings with one field on each line", () => {
    expect(encode("JSONStrings", rows)).toBe(
      rowsMeta +
        ',\n\n\t"data":\n\t[\n' +
        '\t\t{\n\t\t\t"k": "0",\n\t\t\t"s": "a"\n\t\t},\n' +
        '\t\t{\n\t\t\t"k": "1",\n\t\t\t"s": "b"\n\t\t}\n' +
        '\t],\n\n\t"rows": 2' +
        STATISTICS,
    );
  });

  it("writes JSONCompact with a space after each comma of a row", () => {
    expect(encode("JSONCompact", rows)).toBe(
      rowsMeta +
        ',\n\n\t"data":\n\t[\n\t\t[0, "a"],\n\t\t[1, "b"]\n\t],\n\n\t"rows": 2' +
        STATISTICS,
    );
  });

  it("writes JSONColumnsWithMetadata", () => {
    expect(encode("JSONColumnsWithMetadata", rows)).toBe(
      rowsMeta +
        ',\n\n\t"data":\n\t{\n\t\t"k": [0, 1],\n\t\t"s": ["a", "b"]\n\t},\n\n\t"rows": 2' +
        STATISTICS,
    );
  });

  it("writes the JSONCompact*EachRow* formats with a space after each comma", () => {
    expect(encode("JSONCompactEachRow", rows)).toBe('[0, "a"]\n[1, "b"]\n');
    expect(encode("JSONCompactStringsEachRowWithNamesAndTypes", rows)).toBe(
      '["k", "s"]\n["UInt8", "String"]\n["0", "a"]\n["1", "b"]\n',
    );
  });

  it("writes JSONObjectEachRow", () => {
    expect(encode("JSONObjectEachRow", rows)).toBe(
      '{\n\t"row_1": {"k":0,"s":"a"},\n\t"row_2": {"k":1,"s":"b"}\n}\n',
    );
  });

  it("writes empty results", () => {
    const empty = block([["k", "UInt8", []]]);
    const emptyMeta = meta([["k", "UInt8"]]);
    expect(encode("JSON", empty)).toBe(
      emptyMeta + ',\n\n\t"data":\n\t[\n\n\t],\n\n\t"rows": 0' + STATISTICS,
    );
    expect(encode("JSONCompact", empty)).toBe(
      emptyMeta + ',\n\n\t"data":\n\t[\n\n\t],\n\n\t"rows": 0' + STATISTICS,
    );
    expect(encode("JSONColumnsWithMetadata", empty)).toBe(
      emptyMeta + ',\n\n\t"data":\n\t{\n\n\t},\n\n\t"rows": 0' + STATISTICS,
    );
    expect(encode("JSONObjectEachRow", empty)).toBe("{\n\n}\n");
    expect(encode("JSONEachRow", empty)).toBe("");
    expect(encode("CSVWithNames", empty)).toBe('"k"\n');
  });

  function withTotals(
    format: ConstructorParameters<typeof OutputEncoder>[0],
    limit?: number,
  ): string {
    const encoder = new OutputEncoder(format, DefaultOutputSettings);
    const b = block([
      ["k", "UInt8", [0, 1]],
      ["a", "Array(Tuple(UInt8, UInt8))", [[[1, 2]], []]],
    ]);
    let out = encoder.data(b);
    encoder.totalsBlock(
      block([
        ["k", "UInt8", [0]],
        ["a", "Array(Tuple(UInt8, UInt8))", [[[1, 2]]]],
      ]),
    );
    encoder.extremesBlock(
      block([
        ["k", "UInt8", [0, 1]],
        ["a", "Array(Tuple(UInt8, UInt8))", [[], [[1, 2]]]],
      ]),
    );
    out += encoder.finish({
      elapsed_ns: 1000,
      rows_read: 1,
      bytes_read: 8,
      rows_before_limit_at_least: limit,
    });
    return out;
  }
  const totalsMeta = meta([
    ["k", "UInt8"],
    ["a", "Array(Tuple(UInt8, UInt8))"],
  ]);
  // The values of the totals and of the extremes are on one line.
  const totalsAndExtremes =
    ',\n\n\t"totals":\n\t{\n\t\t"k": 0,\n\t\t"a": [[1,2]]\n\t}' +
    ',\n\n\t"extremes":\n\t{\n' +
    '\t\t"min":\n\t\t{\n\t\t\t"k": 0,\n\t\t\t"a": []\n\t\t},\n' +
    '\t\t"max":\n\t\t{\n\t\t\t"k": 1,\n\t\t\t"a": [[1,2]]\n\t\t}\n\t}';

  it("writes totals, extremes and the rows before the limit in JSON", () => {
    expect(withTotals("JSON", 3)).toBe(
      totalsMeta +
        ',\n\n\t"data":\n\t[\n' +
        '\t\t{\n\t\t\t"k": 0,\n\t\t\t"a": [\n\t\t\t\t[\n\t\t\t\t\t1,\n\t\t\t\t\t2\n\t\t\t\t]\n\t\t\t]\n\t\t},\n' +
        '\t\t{\n\t\t\t"k": 1,\n\t\t\t"a": []\n\t\t}\n\t]' +
        totalsAndExtremes +
        ',\n\n\t"rows": 2,\n\n\t"rows_before_limit_at_least": 3' +
        STATISTICS,
    );
  });

  it("writes totals and extremes in JSONCompact", () => {
    expect(withTotals("JSONCompact")).toBe(
      totalsMeta +
        ',\n\n\t"data":\n\t[\n\t\t[0, [[1,2]]],\n\t\t[1, []]\n\t]' +
        ',\n\n\t"totals": [0, [[1,2]]]' +
        ',\n\n\t"extremes":\n\t{\n\t\t"min": [0, []],\n\t\t"max": [1, [[1,2]]]\n\t}' +
        ',\n\n\t"rows": 2' +
        STATISTICS,
    );
  });

  it("writes totals and extremes in JSONColumnsWithMetadata", () => {
    expect(withTotals("JSONColumnsWithMetadata")).toBe(
      totalsMeta +
        ',\n\n\t"data":\n\t{\n\t\t"k": [0, 1],\n\t\t"a": [[[1,2]], []]\n\t}' +
        totalsAndExtremes +
        ',\n\n\t"rows": 2' +
        STATISTICS,
    );
  });

  it("writes totals and extremes in the row formats", () => {
    expect(withTotals("JSONEachRowWithProgress", 3)).toBe(
      '{"meta":[{"name":"k","type":"UInt8"},{"name":"a","type":"Array(Tuple(UInt8, UInt8))"}]}\n' +
        '{"row":{"k":0,"a":[[1,2]]}}\n{"row":{"k":1,"a":[]}}\n' +
        '{"totals":{"k":0,"a":[[1,2]]}}\n' +
        '{"min":{"k":0,"a":[]}}\n{"max":{"k":1,"a":[[1,2]]}}\n' +
        '{"rows_before_limit_at_least":3}\n',
    );
    expect(withTotals("CSV")).toBe(
      '0,"[(1,2)]"\n1,"[]"\n\n0,"[(1,2)]"\n\n0,"[]"\n1,"[(1,2)]"\n',
    );
    expect(withTotals("TabSeparated")).toBe(
      "0\t[(1,2)]\n1\t[]\n\n0\t[(1,2)]\n\n0\t[]\n1\t[(1,2)]\n",
    );
    expect(withTotals("JSONEachRow")).toBe(
      '{"k":0,"a":[[1,2]]}\n{"k":1,"a":[]}\n',
    );
  });
});

describe("[Native] output encoder: nested values in the JSON format", () => {
  /** The text of one value in a row of the `JSON` format. */
  function jsonValue(
    type: string,
    value: unknown,
    settings: Record<string, unknown> = {},
  ): string {
    const text = encode("JSON", block([["v", type, [value]]]), settings);
    const start = text.indexOf('\t\t\t"v": ') + '\t\t\t"v": '.length;
    return text.slice(start, text.indexOf('\n\t\t}\n\t],\n\n\t"rows"'));
  }

  it("writes an array of scalars on one line", () => {
    expect(jsonValue("Array(UInt8)", [1, 2])).toBe("[1,2]");
    expect(jsonValue("Array(Nullable(String))", ["a", null])).toBe(
      '["a",null]',
    );
    expect(jsonValue("Array(UInt8)", [])).toBe("[]");
  });

  it("writes an array of nested values with one element on each line", () => {
    expect(jsonValue("Array(Array(UInt8))", [[1], [2, 3], []])).toBe(
      "[\n\t\t\t\t[1],\n\t\t\t\t[2,3],\n\t\t\t\t[]\n\t\t\t]",
    );
    expect(jsonValue("Array(Map(String, UInt8))", [[["k", 1]]])).toBe(
      '[\n\t\t\t\t{\n\t\t\t\t\t"k": 1\n\t\t\t\t}\n\t\t\t]',
    );
    expect(jsonValue("Array(Nullable(Tuple(a UInt8)))", [[1], null])).toBe(
      '[\n\t\t\t\t{\n\t\t\t\t\t"a": 1\n\t\t\t\t},\n\t\t\t\tnull\n\t\t\t]',
    );
  });

  it("writes tuples and maps with one element on each line", () => {
    expect(jsonValue("Tuple(UInt8, String)", [1, "y"])).toBe(
      '[\n\t\t\t\t1,\n\t\t\t\t"y"\n\t\t\t]',
    );
    expect(jsonValue("Tuple(a UInt8, b Array(UInt8))", [1, [2]])).toBe(
      '{\n\t\t\t\t"a": 1,\n\t\t\t\t"b": [2]\n\t\t\t}',
    );
    expect(jsonValue("Tuple()", [])).toBe("[\n\n\t\t\t]");
    expect(jsonValue("Map(String, Array(UInt8))", [["k", [1, 2]]])).toBe(
      '{\n\t\t\t\t"k": [1,2]\n\t\t\t}',
    );
    expect(jsonValue("Map(String, UInt8)", [])).toBe("{}");
  });

  it("writes the elements of an array of Variant or Dynamic on one line", () => {
    const array = new TypedValue(parseColumnType("Array(UInt8)"), [1, 2]);
    const text = new TypedValue(parseColumnType("String"), "s");
    expect(
      jsonValue("Array(Variant(Array(UInt8), String))", [array, text]),
    ).toBe('[[1,2],"s"]');
    // A value of a Dynamic column has the layout of its type.
    expect(
      jsonValue(
        "Dynamic",
        new TypedValue(parseColumnType("Tuple(a UInt8, b String)"), [1, "x"]),
      ),
    ).toBe('{\n\t\t\t\t"a": 1,\n\t\t\t\t"b": "x"\n\t\t\t}');
  });

  it("follows the settings of tuples and maps", () => {
    expect(
      jsonValue("Tuple(a UInt8, b String)", [1, "x"], {
        output_format_json_named_tuples_as_objects: 0,
      }),
    ).toBe('[\n\t\t\t\t1,\n\t\t\t\t"x"\n\t\t\t]');
    const settings = { output_format_json_skip_null_value_in_named_tuples: 1 };
    const type = "Tuple(a Nullable(UInt8), b Nullable(String))";
    expect(jsonValue(type, [null, "x"], settings)).toBe(
      '{\n\t\t\t\t"b": "x"\n\t\t\t}',
    );
    expect(jsonValue(type, [null, null], settings)).toBe("{\n\n\t\t\t}");
    expect(
      jsonValue("Map(String, UInt8)", [["k", 1]], {
        output_format_json_map_as_array_of_tuples: 1,
      }),
    ).toBe(
      '[\n\t\t\t\t{\n\t\t\t\t\t"keys": "k",\n\t\t\t\t\t"values": 1\n\t\t\t\t}\n\t\t\t]',
    );
    expect(
      jsonValue("Array(Tuple(UInt8, UInt8))", [[1, 2]], {
        output_format_json_pretty_print: 0,
      }),
    ).toBe("[[1,2]]");
  });

  it("writes a map as an array of tuples in the row formats", () => {
    const b = block([
      [
        "m",
        "Map(String, UInt8)",
        [
          [
            ["k", 1],
            ["z", 2],
          ],
        ],
      ],
    ]);
    const settings = { output_format_json_map_as_array_of_tuples: 1 };
    expect(encode("JSONEachRow", b, settings)).toBe(
      '{"m":[{"keys":"k","values":1},{"keys":"z","values":2}]}\n',
    );
    expect(
      encode("JSONEachRow", b, {
        ...settings,
        output_format_json_named_tuples_as_objects: 0,
      }),
    ).toBe('{"m":[["k",1],["z",2]]}\n');
    // The text formats do not use the setting.
    expect(encode("TabSeparated", b, settings)).toBe("{'k':1,'z':2}\n");
  });

  it("writes a JSON column that the server sent as text", () => {
    const value = new RawJSONValue(
      '{"a":[[1,2],[3]],"c":[{"x":1},null],"d":[{"x":1},1],"e":[[1],"s"],"i":[null,null],"l":[{}],"m":{"n":{"o":1}},"s":"q\\"t, [x] {y}"}',
    );
    expect(jsonValue("JSON", value)).toBe(
      [
        "{",
        '\t"a": [',
        "\t\t[1,2],",
        "\t\t[3]",
        "\t],",
        '\t"c": [',
        "\t\t{",
        '\t\t\t"x": 1',
        "\t\t},",
        "\t\tnull",
        "\t],",
        '\t"d": [{',
        '\t\t\t"x": 1',
        "\t\t},1],",
        '\t"e": [[1],"s"],',
        '\t"i": [null,null],',
        '\t"l": [',
        "\t\t{",
        "",
        "\t\t}",
        "\t],",
        '\t"m": {',
        '\t\t"n": {',
        '\t\t\t"o": 1',
        "\t\t}",
        "\t},",
        '\t"s": "q\\"t, [x] {y}"',
        "}",
      ]
        .join("\n\t\t\t")
        // The empty object has an empty line without tabs.
        .replace("{\n\t\t\t\n", "{\n\n"),
    );
    expect(jsonValue("JSON", new RawJSONValue("{}"))).toBe("{\n\n\t\t\t}");
    // The row formats keep the text of the server.
    expect(encode("JSONEachRow", block([["j", "JSON", [value]]]))).toBe(
      `{"j":${value.text}}\n`,
    );
  });

  it("writes a JSON column that the server sent as paths", () => {
    const value = new JSONObjectValue([
      ["a.b", parseColumnType("UInt32"), 1],
      [
        "a.c",
        parseColumnType("Dynamic"),
        new TypedValue(parseColumnType("Array(Nullable(Int64))"), [1n, 2n]),
      ],
      [
        "d",
        parseColumnType("Dynamic"),
        new TypedValue(parseColumnType("String"), "x"),
      ],
    ]);
    expect(jsonValue("JSON", value)).toBe(
      '{\n\t\t\t\t"a": {\n\t\t\t\t\t"b": 1,\n\t\t\t\t\t"c": [1,2]\n\t\t\t\t},\n\t\t\t\t"d": "x"\n\t\t\t}',
    );
    expect(jsonValue("JSON", new JSONObjectValue([]))).toBe("{\n\n\t\t\t}");
    expect(encode("JSONEachRow", block([["j", "JSON", [value]]]))).toBe(
      '{"j":{"a":{"b":1,"c":[1,2]},"d":"x"}}\n',
    );
  });
});

describe("[Native] output encoder: strings", () => {
  it("writes the JSON escapes of the server", () => {
    const b = block([
      ["s", "String", ['\u0000\u0001\u001f\u007f\b\f\n\r\t"\\/  ']],
    ]);
    expect(encode("JSONEachRow", b)).toBe(
      '{"s":"\\u0000\\u0001\\u001F\u007f\\b\\f\\n\\r\\t\\"\\\\\\/\\u2028\\u2029"}\n',
    );
  });

  it("writes the names with the JSON escapes", () => {
    const b = block([
      ["a/b", "UInt8", [1]],
      ['q"t', "Tuple(`x/y` UInt8)", [[2]]],
      ["m", "Map(String, UInt8)", [[["k/1", 3]]]],
    ]);
    expect(encode("JSONEachRow", b)).toBe(
      '{"a\\/b":1,"q\\"t":{"x\\/y":2},"m":{"k\\/1":3}}\n',
    );
    expect(
      encode("JSONEachRow", b, {
        output_format_json_escape_forward_slashes: 0,
      }),
    ).toBe('{"a/b":1,"q\\"t":{"x/y":2},"m":{"k/1":3}}\n');
    expect(encode("JSONCompactEachRowWithNames", b).split("\n")[0]).toBe(
      '["a\\/b", "q\\"t", "m"]',
    );
  });

  it("does not escape the slash in the object name of JSONObjectEachRow", () => {
    const b = block([
      ["name", "String", ['k/1"']],
      ["s", "String", ["a/b"]],
    ]);
    expect(
      encode("JSONObjectEachRow", b, {
        format_json_object_each_row_column_for_object_name: "name",
      }),
    ).toBe('{\n\t"k/1\\"": {"s":"a\\/b"}\n}\n');
  });

  // The decoder keeps each byte that is not UTF-8 as a lone low surrogate
  // (0xDC00 + the byte). The connection changes them back to bytes.
  const invalid = "A\udcff\udcffB\udcc3";
  const bytes = block([
    ["s", "String", [invalid]],
    ["a", "Array(String)", [[invalid]]],
    // U+10080 has the low surrogate U+DC80: it is a valid character.
    ["ok", "String", ["𐂀"]],
  ]);

  it("does not change the bytes that are not UTF-8", () => {
    expect(encode("JSONEachRow", bytes)).toBe(
      `{"s":"${invalid}","a":["${invalid}"],"ok":"𐂀"}\n`,
    );
    expect(encode("JSONCompactEachRow", bytes)).toBe(
      `["${invalid}", ["${invalid}"], "𐂀"]\n`,
    );
    expect(encode("JSONStringsEachRow", bytes)).toBe(
      `{"s":"${invalid}","a":"['${invalid}']","ok":"𐂀"}\n`,
    );
    expect(encode("JSONObjectEachRow", bytes)).toBe(
      `{\n\t"row_1": {"s":"${invalid}","a":["${invalid}"],"ok":"𐂀"}\n}\n`,
    );
    expect(encode("CSV", bytes)).toBe(`"${invalid}","['${invalid}']","𐂀"\n`);
    expect(encode("TabSeparated", bytes)).toBe(
      `${invalid}\t['${invalid}']\t𐂀\n`,
    );
    expect(encode("TabSeparatedRaw", bytes)).toBe(
      `${invalid}\t['${invalid}']\t𐂀\n`,
    );
  });

  it("replaces the bytes that are not UTF-8 in the JSON documents", () => {
    // The server writes one U+FFFD for each sequence of such bytes.
    const valid = "A�B�";
    for (const format of [
      "JSON",
      "JSONStrings",
      "JSONCompact",
      "JSONCompactStrings",
      "JSONColumnsWithMetadata",
    ] as const) {
      const text = encode(format, bytes);
      expect(text).not.toMatch(/[\udc81-\udcff]/);
      expect(text).toContain(valid);
      expect(text).toContain("𐂀");
    }
    expect(
      encode("JSONEachRow", bytes, { output_format_json_validate_utf8: 1 }),
    ).toBe(`{"s":"${valid}","a":["${valid}"],"ok":"𐂀"}\n`);
    expect(
      encode("CSV", bytes, { output_format_json_validate_utf8: 1 }),
    ).toContain(invalid);
  });
});

describe("[Native] output encoder: numbers", () => {
  it("writes the shortest text of Float32 values", () => {
    const values = [
      -0,
      0,
      Math.fround(0.1),
      Math.fround(1e-10),
      16777216,
      Math.fround(3.4028235e38),
      Math.fround(1.17549435e-38),
      Math.fround(123456.789),
      -1.5,
      Math.fround(1e21),
      // A power of two: the next smaller value is nearer than the next larger.
      Math.fround(2 ** -30),
      Math.fround(2 ** 70),
      1e-45,
    ];
    expect(
      encode("TabSeparated", block([["f", "Float32", values]])).split("\n"),
    ).toEqual([
      "-0",
      "0",
      "0.1",
      "1e-10",
      "16777216",
      "3.4028235e38",
      "1.1754944e-38",
      "123456.79",
      "-1.5",
      "1e21",
      "9.313226e-10",
      "1.1805916e21",
      "1e-45",
      "",
    ]);
    expect(encode("JSONEachRow", block([["f", "Float32", [-0]]]))).toBe(
      '{"f":-0}\n',
    );
    expect(encode("CSV", block([["f", "Float32", [-0]]]))).toBe("-0\n");
  });

  it("writes Float64 values", () => {
    expect(
      encode(
        "TabSeparated",
        block([["f", "Float64", [-0, 1e21, 1.5e-7, 1 / 3, Infinity, NaN]]]),
      ).split("\n"),
    ).toEqual(["-0", "1e21", "1.5e-7", "0.3333333333333333", "inf", "nan", ""]);
  });

  it("writes intervals as Kusto timespans", () => {
    const settings = { interval_output_format: "kusto" };
    const b = block([
      ["s", "IntervalSecond", [5n, -5n, 86400n, 0n]],
      ["ms", "IntervalMillisecond", [1500n, -1n, -86400001n, 0n]],
      ["h", "IntervalHour", [30n, -25n, 1n, 0n]],
      ["ns", "IntervalNanosecond", [700n, -100n, 123456789000n, 0n]],
    ]);
    expect(encode("JSONCompactEachRow", b, settings)).toBe(
      '["00:00:05", "00:00:01.5000000", "1.06:00:00", "00:00:00.0000007"]\n' +
        '["-00:00:05", "-00:00:00.0010000", "-1.01:00:00", "-00:00:00.0000001"]\n' +
        '["1.00:00:00", "-1.00:00:00.0010000", "01:00:00", "00:02:03.4567890"]\n' +
        '["00:00:00", "00:00:00", "00:00:00", "00:00:00"]\n',
    );
    const nested = block([
      ["s", "IntervalDay", [2n]],
      ["a", "Array(IntervalSecond)", [[5n]]],
      ["n", "Nullable(IntervalWeek)", [null]],
    ]);
    expect(encode("CSV", nested, settings)).toBe(
      '"2.00:00:00","[\'00:00:05\']",\\N\n',
    );
    expect(encode("TabSeparated", nested, settings)).toBe(
      "2.00:00:00\t['00:00:05']\t\\N\n",
    );
    // Without the setting, an interval is a number.
    expect(encode("CSV", nested)).toBe('2,"[5]",\\N\n');
    expect(() =>
      encode("CSV", block([["m", "IntervalMonth", [1n]]]), settings),
    ).toThrow("Cannot format a calendar interval in Kusto timespan format");
    expect(() =>
      encode("CSV", block([["n", "IntervalNanosecond", [150n]]]), settings),
    ).toThrow("not a multiple of 100");
  });
});

describe("[Native] output encoder: settings", () => {
  const rows = block([["n", "UInt8", [0, 1]]]);

  it("has each output setting in the list that the client reads", () => {
    expect(OutputSettingNames).toEqual(
      expect.arrayContaining([
        "date_time_output_format",
        "interval_output_format",
        "output_format_json_array_of_rows",
        "output_format_json_pretty_print",
        "output_format_json_validate_utf8",
        "output_format_write_statistics",
        "output_format_csv_header_serialize_tuple_into_separate_columns",
      ]),
    );
    const settings = applyOutputSettings(DefaultOutputSettings, {
      date_time_output_format: "iso",
      output_format_write_statistics: "0",
    });
    expect(settings.date_time_output_format).toBe("iso");
    expect(settings.output_format_write_statistics).toBe(false);
    expect(DefaultOutputSettings.date_time_output_format).toBe("simple");
  });

  it("writes the rows as one JSON array", () => {
    const settings = { output_format_json_array_of_rows: 1 };
    expect(encode("JSONEachRow", rows, settings)).toBe(
      '[\n{"n":0},\n{"n":1}\n]\n',
    );
    expect(encode("JSONStringsEachRow", rows, settings)).toBe(
      '[\n{"n":"0"},\n{"n":"1"}\n]\n',
    );
    expect(encode("JSONEachRow", block([["n", "UInt8", []]]), settings)).toBe(
      "[\n\n]\n",
    );
    // The setting does not apply to the other formats.
    expect(encode("JSONCompactEachRow", rows, settings)).toBe("[0]\n[1]\n");
  });

  it("can leave out the statistics", () => {
    const text = encode("JSON", rows, { output_format_write_statistics: 0 });
    expect(text.endsWith('\n\t],\n\n\t"rows": 2\n}\n')).toBe(true);
    expect(
      encode("JSONColumnsWithMetadata", rows, {
        output_format_write_statistics: 0,
      }).endsWith('\n\t},\n\n\t"rows": 2\n}\n'),
    ).toBe(true);
  });

  it("writes tuples in CSV as the server does", () => {
    const b = block([
      ["t", "Tuple(a UInt8, b String)", [[1, "x"]]],
      ["u", "Tuple(UInt8, Tuple(UInt8, UInt8))", [[1, [2, 3]]]],
      ["nt", "Nullable(Tuple(UInt8, String))", [[1, "x"]]],
      ["nn", "Nullable(Tuple(UInt8, String))", [null]],
      ["e", "Tuple()", [[]]],
      [
        "d",
        "Dynamic",
        [new TypedValue(parseColumnType("Tuple(UInt8, String)"), [1, "y"])],
      ],
      ["z", "UInt8", [5]],
    ]);
    // A tuple in Nullable is one field. An empty tuple is one empty field.
    // A tuple in a Dynamic column has one field for each element, but one
    // column in the header.
    expect(encode("CSVWithNames", b)).toBe(
      '"t.a","t.b","u.1","u.2.1","u.2.2","nt","nn","e","d","z"\n' +
        '1,"x",1,2,3,"(1,\'x\')",\\N,,1,"y",5\n',
    );
    expect(
      encode("CSVWithNames", b, {
        output_format_csv_header_serialize_tuple_into_separate_columns: 0,
      }),
    ).toBe(
      '"t","u","nt","nn","e","d","z"\n1,"x",1,2,3,"(1,\'x\')",\\N,,1,"y",5\n',
    );
    expect(
      encode("CSVWithNames", b, {
        output_format_csv_serialize_tuple_into_separate_columns: 0,
      }),
    ).toBe(
      '"t","u","nt","nn","e","d","z"\n"(1,\'x\')","(1,(2,3))","(1,\'x\')",\\N,"()","(1,\'y\')",5\n',
    );
  });

  it("uses the Bool representations only for a value at the top level", () => {
    const b = block([
      ["b", "Bool", [true]],
      ["a", "Array(Bool)", [[true, false]]],
    ]);
    const settings = {
      bool_true_representation: "yes",
      bool_false_representation: "no",
    };
    expect(encode("TabSeparated", b, settings)).toBe("yes\t[true,false]\n");
    expect(encode("CSV", b, settings)).toBe('yes,"[true,false]"\n');
    expect(encode("JSONEachRow", b, settings)).toBe(
      '{"b":true,"a":[true,false]}\n',
    );
  });
});

describe("[Native] settingsFromQuery", () => {
  it("reads the SETTINGS clause at the end of a statement", () => {
    expect(
      settingsFromQuery(
        "SELECT 1 SETTINGS output_format_json_quote_64bit_integers = 1, date_time_output_format='iso'",
      ),
    ).toEqual({
      output_format_json_quote_64bit_integers: "1",
      date_time_output_format: "iso",
    });
  });

  it("reads the clause before or after the FORMAT clause", () => {
    expect(
      settingsFromQuery("SELECT 1 SETTINGS a = 1, b = 2 FORMAT JSONEachRow"),
    ).toEqual({ a: "1", b: "2" });
    expect(
      settingsFromQuery("SELECT 1 FORMAT JSONEachRow SETTINGS a = true;"),
    ).toEqual({ a: "true" });
    expect(
      settingsFromQuery(
        "select 1\nsettings\n  a=-1.5 ,\n  b = 'x'\nformat CSV",
      ),
    ).toEqual({ a: "-1.5", b: "x" });
  });

  it("decodes the escapes of a quoted value", () => {
    expect(
      settingsFromQuery(
        String.raw`SELECT 1 SETTINGS a = 'it\'s', b = 'tab\t', c = 'two''quotes', d = '\\N'`,
      ),
    ).toEqual({ a: "it's", b: "tab\t", c: "two'quotes", d: "\\N" });
  });

  it("returns nothing when the statement has no SETTINGS clause", () => {
    expect(settingsFromQuery("SELECT 1")).toEqual({});
    expect(settingsFromQuery("")).toEqual({});
    expect(settingsFromQuery("SELECT settings FROM t")).toEqual({});
    expect(settingsFromQuery("SELECT 1 AS mysettings")).toEqual({});
  });

  it("skips string literals, quoted identifiers and comments", () => {
    expect(settingsFromQuery("SELECT 'SETTINGS a = 1'")).toEqual({});
    expect(settingsFromQuery("SELECT 1 AS `SETTINGS a = 1`")).toEqual({});
    expect(settingsFromQuery('SELECT 1 AS "SETTINGS a = 1"')).toEqual({});
    expect(settingsFromQuery("SELECT 1 -- SETTINGS a = 1")).toEqual({});
    expect(settingsFromQuery("SELECT 1 /* SETTINGS a = 1 */")).toEqual({});
    expect(
      settingsFromQuery(
        "SELECT 'it''s', '\\'' /* c */ SETTINGS /* c */ a = 1, -- c\n b = 2",
      ),
    ).toEqual({ a: "1", b: "2" });
  });

  it("skips the SETTINGS clauses in parentheses", () => {
    expect(
      settingsFromQuery("SELECT * FROM (SELECT 1 SETTINGS a = 1)"),
    ).toEqual({});
    expect(
      settingsFromQuery(
        "SELECT * FROM (SELECT 1 SETTINGS a = 1) SETTINGS b = 2",
      ),
    ).toEqual({ b: "2" });
  });

  it("uses the last clause of the statement", () => {
    expect(
      settingsFromQuery(
        "SELECT 1 SETTINGS a = 1 UNION ALL SELECT 2 SETTINGS a = 2",
      ),
    ).toEqual({ a: "2" });
    expect(
      settingsFromQuery("INSERT INTO t SETTINGS async_insert = 1 VALUES (1)"),
    ).toEqual({ async_insert: "1" });
  });
});

describe("[Native] FORMAT in SQL", () => {
  it.each([
    "SELECT 'x' format JSONEachRow -- comment",
    "SELECT (1) FORMAT /* comment */ JSONEachRow; -- comment",
    "SELECT 1 SETTINGS a = 1 FORMAT JSONEachRow",
    "SELECT 1 FORMAT JSONEachRow SETTINGS a = 'b';",
    "SELECT $$FORMAT CSV$$ FORMAT JSONEachRow",
  ])("reads the format in %s", (query) => {
    expect(readQueryClauses(query).format).toBe("JSONEachRow");
  });

  it.each([
    "SELECT 1 -- FORMAT CSV",
    "SELECT 1 /* not /* FORMAT JSON */ FORMAT CSV */",
    "SELECT 'FORMAT CSV'",
    "SELECT format CSV",
    "SELECT * FROM format CSV",
    "SELECT * FROM (SELECT 1 FORMAT CSV)",
  ])("ignores a FORMAT that is not a clause in %s", (query) => {
    expect(readQueryClauses(query).format).toBeUndefined();
  });
});
