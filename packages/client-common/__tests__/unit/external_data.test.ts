import { describe, it, expect } from "vitest";
import { defaultJSONHandling } from "../../src/parse";
import {
  prepareExternalData,
  type ExternalDataEntry,
} from "../../src/external_data";
import { buildMultipartBytes } from "../../src/utils/multipart";
import { toSearchParams } from "../../src/utils/url";

function prepare(
  entries: ReadonlyArray<ExternalDataEntry>,
  stringify = defaultJSONHandling.stringify,
) {
  return prepareExternalData(
    entries,
    { parse: JSON.parse, stringify },
    (stream) => stream as string,
  );
}

describe("prepareExternalData", () => {
  it("normalizes string and array structure and types definitions", () => {
    const res = prepare([
      {
        name: "t1",
        structure: [" id String ", " n UInt32 "],
        format: "TSV",
        data: "a\t1\n",
      },
      {
        name: "t2",
        types: ["String", "Tuple(String, UInt8)"],
        data: "b\t('x',2)\n",
      },
    ]);

    expect(res).toEqual([
      {
        name: "t1",
        structure: "id String, n UInt32",
        types: undefined,
        format: "TSV",
        data: "a\t1\n",
      },
      {
        name: "t2",
        structure: undefined,
        types: "String, Tuple(String, UInt8)",
        format: undefined,
        data: "b\t('x',2)\n",
      },
    ]);
  });

  it("encodes JSONEachRow and JSONCompactEachRow arrays using custom stringify", () => {
    const res = prepare(
      [
        {
          name: "j1",
          structure: "id String, n UInt32",
          format: "JSONEachRow",
          data: [
            { id: "a", n: 1 },
            { id: "b", n: 2 },
          ],
        },
        {
          name: "j2",
          types: "String, UInt32",
          format: "JSONCompactEachRow",
          data: [["c", 3]],
        },
      ],
      (v) => JSON.stringify(v),
    );
    expect(res[0]?.data).toBe('{"id":"a","n":1}\n{"id":"b","n":2}\n');
    expect(res[1]?.data).toBe('["c",3]\n');
  });

  it("passes string, Uint8Array, and empty JSON arrays through cleanly", () => {
    const bytes = new Uint8Array([0x50, 0x41, 0x52, 0x31]);
    const res = prepare([
      {
        name: "raw_csv",
        structure: "id String, n UInt32",
        format: "CSV",
        data: '"a",1\n"b",2\n',
      },
      {
        name: "bin",
        structure: "id String",
        format: "Parquet",
        data: bytes,
      },
      {
        name: "empty_rows",
        structure: "id String",
        format: "JSONEachRow",
        data: [],
      },
    ]);
    expect(res[0]?.data).toBe('"a",1\n"b",2\n');
    expect(res[1]?.data).toBe(bytes);
    expect(res[2]?.data).toBe("");
  });

  it("validates invalid names, collisions, duplicates, schema errors, and non-JSON array formats", () => {
    expect(() =>
      prepare([{ name: "bad name", structure: "x UInt8", data: "" }]),
    ).toThrow(/Invalid external_data name/);

    expect(() =>
      prepare([{ name: "query", structure: "x UInt8", data: "" }]),
    ).toThrow(/collides with ClickHouse HTTP form parameter names/);

    expect(() =>
      prepare([{ name: "param_foo", structure: "x UInt8", data: "" }]),
    ).toThrow(/collides with ClickHouse HTTP form parameter names/);

    expect(() =>
      prepare([{ name: "t_structure", structure: "x UInt8", data: "" }]),
    ).toThrow(/collides with ClickHouse HTTP form parameter names/);

    expect(() =>
      prepare([
        { name: "dup", structure: "x UInt8", data: "" },
        { name: "dup", structure: "x UInt8", data: "" },
      ]),
    ).toThrow(/Duplicate external_data table name: "dup"/);

    expect(() =>
      prepare([{ name: "t", data: "" } as unknown as ExternalDataEntry]),
    ).toThrow(/must specify exactly one of "structure" or "types"/);

    expect(() =>
      prepare([
        {
          name: "t",
          structure: "x UInt8",
          types: "UInt8",
          data: "",
        } as unknown as ExternalDataEntry,
      ]),
    ).toThrow(/must specify exactly one of "structure" or "types"/);

    expect(() => prepare([{ name: "t", structure: "   ", data: "" }])).toThrow(
      /empty "structure" definition/,
    );

    expect(() =>
      prepare([
        {
          name: "t",
          structure: "x UInt8",
          format: "TSV",
          data: [{ x: 1 }],
        },
      ]),
    ).toThrow(
      /array data is only supported for row-per-line JSON formats .*\(got "TSV"\)/,
    );

    expect(() =>
      prepare([
        {
          name: "t",
          structure: "x UInt8",
          format: "CSV",
          data: [[1]],
        },
      ]),
    ).toThrow(
      /array data is only supported for row-per-line JSON formats .*\(got "CSV"\)/,
    );

    expect(() =>
      prepare([
        {
          name: "t",
          structure: "x UInt8",
          format: "Parquet",
          data: [{ x: 1 }],
        },
      ]),
    ).toThrow(
      /array data is only supported for row-per-line JSON formats .*\(got "Parquet"\)/,
    );

    for (const format of ["JSON", "JSONObjectEachRow", "JSONCompact"]) {
      expect(() =>
        prepare([
          { name: "t", structure: "x UInt8", format, data: [{ x: 1 }] },
        ]),
      ).toThrow(
        `array data is only supported for row-per-line JSON formats such as JSONEachRow or JSONCompactEachRow (got "${format}")`,
      );
    }
  });
});

describe("buildMultipartBytes and toSearchParams with external_data", () => {
  it("encodes fields and binary/string file parts with filename headers", () => {
    const boundary = "----test-boundary";
    const bytes = buildMultipartBytes(
      { query: "SELECT * FROM ext", param_p: "42" },
      [
        { name: "ext", value: "a\t1\n" },
        { name: "bin", value: new Uint8Array([1, 2, 3]) },
      ],
      boundary,
    );

    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toContain(
      'Content-Disposition: form-data; name="query"\r\n\r\nSELECT * FROM ext\r\n',
    );
    expect(decoded).toContain(
      'Content-Disposition: form-data; name="param_p"\r\n\r\n42\r\n',
    );
    expect(decoded).toContain(
      'Content-Disposition: form-data; name="ext"; filename="ext"\r\nContent-Type: application/octet-stream\r\n\r\na\t1\n\r\n',
    );
    expect(decoded).toContain(
      'Content-Disposition: form-data; name="bin"; filename="bin"\r\nContent-Type: application/octet-stream\r\n\r\n\x01\x02\x03\r\n',
    );
    expect(decoded.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it("serializes <name>_structure, <name>_types, and <name>_format in toSearchParams", () => {
    const external_data = prepare([
      { name: "t1", structure: "id String, n UInt32", format: "CSV", data: "" },
      { name: "t2", types: ["String", "UInt64"], data: "" },
    ]);
    const search = toSearchParams({
      database: "default",
      query_id: "qid",
      external_data,
    });
    expect(search.get("t1_structure")).toBe("id String, n UInt32");
    expect(search.get("t1_format")).toBe("CSV");
    expect(search.get("t2_types")).toBe("String, UInt64");
    expect(search.has("t2_format")).toBe(false);
  });

  it("rejects an external table URL key that is the same as a setting or a request parameter", () => {
    const withFormat = prepare([
      { name: "default", structure: "s String", format: "CSV", data: "" },
    ]);
    expect(() =>
      toSearchParams({
        database: "default",
        query_id: "qid",
        external_data: withFormat,
        clickhouse_settings: { default_format: "JSONEachRow" },
      }),
    ).toThrow(
      'Invalid external_data name: the URL parameter "default_format" of an external table',
    );

    const dateTime = prepare([
      {
        name: "date_time_input",
        structure: "s String",
        format: "CSV",
        data: "",
      },
    ]);
    expect(() =>
      toSearchParams({
        database: "default",
        query_id: "qid",
        external_data: dateTime,
        clickhouse_settings: { date_time_input_format: "best_effort" },
      }),
    ).toThrow('"date_time_input_format"');

    // Without a format, a table named `default` sends only `default_structure`.
    const withoutFormat = prepare([
      { name: "default", structure: "s String", data: "" },
    ]);
    const search = toSearchParams({
      database: "default",
      query_id: "qid",
      external_data: withoutFormat,
      clickhouse_settings: { default_format: "JSONEachRow" },
    });
    expect(search.get("default_structure")).toBe("s String");
    expect(search.getAll("default_format")).toEqual(["JSONEachRow"]);
  });
});
