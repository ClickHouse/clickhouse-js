import "server-only";

import {
  Cursor,
  readRows,
  readDateTime64P3,
  readEnum8,
  readString,
  readIPv4,
  formatIPv4,
  readUUID,
  formatUUID,
  readUInt16,
  readFloat64,
  type Reader,
} from "@clickhouse/rowbinary";

import { command, queryRowBinary } from "./clickhouse";

export const LOGS_TABLE = "demo_logs";

/**
 * One decoded log row, in the column order the table stores them — which is also
 * the order the `SELECT` below lists them, which is the order they arrive on the
 * RowBinary wire. Keep these three in lock-step.
 */
export interface LogRow {
  timestamp: Date;
  level: LogLevel;
  service: string;
  host: string;
  traceId: string;
  status: number;
  durationMs: number;
  message: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * `Enum8('debug'=1,'info'=2,'warn'=3,'error'=4)`. The wire carries only the
 * underlying Int8; the name map lives in the column type, so we map it here. (The
 * skill's preferred shape: keep the number on the hot path, resolve the name at
 * the edge — which is exactly what this reader is.)
 */
const LEVEL_BY_ID: Record<number, LogLevel> = {
  1: "debug",
  2: "info",
  3: "warn",
  4: "error",
};

/**
 * Read exactly one log row from the cursor.
 *
 * This is the clear, API-combinator form the `@clickhouse/rowbinary` README calls
 * "correct, clear, and a fine default" — one leaf read per column, in wire order.
 * The row mixes fixed-width columns (DateTime64, Enum8, IPv4, UUID, UInt16,
 * Float64) with variable-width ones (the two Strings), so it is a natural fit for
 * the combinator style. If this became a hot path you'd ask the skill to
 * monomorphize it: inline each leaf body and coalesce the bounds checks across
 * the fixed-width run. For a paged UI it is nowhere near hot — clarity wins.
 *
 * Wire order matches the SELECT in `fetchLogsPage`:
 *   timestamp DateTime64(3) | level Enum8 | service LowCardinality(String)
 *   host IPv4 | trace_id UUID | status UInt16 | duration_ms Float64 | message String
 */
const readLogRow: Reader<LogRow> = (s) => {
  // DateTime64(3) — P=3 is a JS Date's own millisecond resolution, lossless.
  const timestamp = readDateTime64P3(s);
  // Enum8 — underlying Int8, mapped to its name.
  const level = LEVEL_BY_ID[readEnum8(s)] ?? "info";
  // LowCardinality(String) — transparent in RowBinary, decode as plain String.
  const service = readString(s);
  // IPv4 — 4 LE bytes as a UInt32; format to dotted-quad.
  const host = formatIPv4(readIPv4(s));
  // UUID — two byte-reversed LE UInt64 halves; format to canonical 8-4-4-4-12.
  const traceId = formatUUID(readUUID(s));
  // UInt16
  const status = readUInt16(s);
  // Float64
  const durationMs = readFloat64(s);
  // String (LEB128 length prefix + UTF-8 bytes)
  const message = readString(s);

  return {
    timestamp,
    level,
    service,
    host,
    traceId,
    status,
    durationMs,
    message,
  };
};

/** Drive `readLogRow` over a full RowBinary buffer to an array of rows. */
const readLogRows = readRows(readLogRow);

export interface LogsPage {
  rows: LogRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Fetch one page of logs, newest first, decoded from RowBinary.
 *
 * Two queries: one for the page of rows (`FORMAT RowBinary`, decoded here), one
 * for the total count (so the UI can render page N of M). The count is cheap on
 * MergeTree and keeps the demo's pager honest.
 */
export async function fetchLogsPage(
  page: number,
  pageSize: number,
): Promise<LogsPage> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeSize =
    Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 25;
  const offset = (safePage - 1) * safeSize;

  const [buffer, total] = await Promise.all([
    queryRowBinary(
      `SELECT timestamp, level, service, host, trace_id, status, duration_ms, message
       FROM ${LOGS_TABLE}
       ORDER BY timestamp DESC
       LIMIT ${safeSize} OFFSET ${offset}
       FORMAT RowBinary`,
    ),
    fetchTotal(),
  ]);

  const rows = readLogRows(new Cursor(buffer));
  return {
    rows,
    page: safePage,
    pageSize: safeSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
  };
}

/** Total row count, decoded from a one-cell `UInt64` RowBinary response. */
async function fetchTotal(): Promise<number> {
  const buffer = await queryRowBinary(
    `SELECT count() FROM ${LOGS_TABLE} FORMAT RowBinary`,
  );
  const s = new Cursor(buffer);
  // count() is UInt64 → bigint on the wire; the table is demo-sized, so it fits a Number.
  return Number(s.view.getBigUint64(0, true));
}

/** True if the demo table exists and has at least one row. */
export async function tableHasData(): Promise<boolean> {
  try {
    return (await fetchTotal()) > 0;
  } catch {
    return false;
  }
}

/** Used by the seed script to (re)create the table. */
export async function createTable(): Promise<void> {
  await command(
    `CREATE TABLE IF NOT EXISTS ${LOGS_TABLE} (
       timestamp   DateTime64(3),
       level       Enum8('debug' = 1, 'info' = 2, 'warn' = 3, 'error' = 4),
       service     LowCardinality(String),
       host        IPv4,
       trace_id    UUID,
       status      UInt16,
       duration_ms Float64,
       message     String
     )
     ENGINE = MergeTree
     ORDER BY timestamp`,
  );
}
