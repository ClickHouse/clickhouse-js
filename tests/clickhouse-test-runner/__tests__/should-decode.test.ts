import { describe, expect, it } from "vitest";
import { shouldDecode } from "../src/backends/rowbinary.js";

describe("shouldDecode", () => {
  it("routes result-returning statements to the decode path", () => {
    expect(shouldDecode("SELECT 1")).toBe(true);
    expect(shouldDecode("select 1")).toBe(true);
    expect(shouldDecode("WITH 1 AS x SELECT x")).toBe(true);
    expect(shouldDecode("SHOW TABLES")).toBe(true);
    expect(shouldDecode("DESCRIBE TABLE system.one")).toBe(true);
    expect(shouldDecode("EXISTS TABLE system.one")).toBe(true);
    expect(shouldDecode("EXPLAIN SELECT 1")).toBe(true);
    expect(shouldDecode("(SELECT 1) UNION ALL (SELECT 2)")).toBe(true);
  });

  it("does not decode statements with an explicit FORMAT clause", () => {
    expect(shouldDecode("SELECT 1 FORMAT JSON")).toBe(false);
    expect(shouldDecode("SELECT 1 FORMAT TabSeparated")).toBe(false);
    expect(shouldDecode("SELECT 1 SETTINGS max_threads=1 FORMAT Pretty")).toBe(
      false,
    );
  });

  it("does not decode DDL / INSERT / SET / other non-result statements", () => {
    expect(shouldDecode("CREATE TABLE t (a UInt8) ENGINE = Memory")).toBe(
      false,
    );
    expect(shouldDecode("INSERT INTO t VALUES (1)")).toBe(false);
    expect(shouldDecode("INSERT INTO t FORMAT Values (1)")).toBe(false);
    expect(shouldDecode("DROP TABLE IF EXISTS t")).toBe(false);
    expect(shouldDecode("SET max_threads = 1")).toBe(false);
    expect(shouldDecode("ALTER TABLE t ADD COLUMN b UInt8")).toBe(false);
  });

  it("does not confuse the FORMAT keyword with formatXxx functions", () => {
    expect(shouldDecode("SELECT formatDateTime(now(), '%Y')")).toBe(true);
    expect(shouldDecode("SELECT formatReadableSize(1024)")).toBe(true);
  });

  it("skips leading comments and whitespace when finding the keyword", () => {
    expect(shouldDecode("-- a comment\nSELECT 1")).toBe(true);
    expect(shouldDecode("/* block */ SELECT 1")).toBe(true);
    expect(
      shouldDecode("   \n  CREATE TABLE t (a UInt8) ENGINE = Memory"),
    ).toBe(false);
  });
});
