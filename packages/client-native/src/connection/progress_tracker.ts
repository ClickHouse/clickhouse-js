import type { ClickHouseSummary } from "../common/index";
import type { Block, ProfileInfo, Progress } from "../protocol/packets";

/** Collects the Progress packets: the server sends increments. */
export class ProgressTracker {
  private readonly total: Progress = {
    read_rows: 0n,
    read_bytes: 0n,
    total_rows_to_read: 0n,
    total_bytes_to_read: 0n,
    written_rows: 0n,
    written_bytes: 0n,
    elapsed_ns: 0n,
  };
  private resultRows = 0n;
  private insertedRows = 0n;
  private insertedBytes = 0n;
  private sentRows = 0n;
  private resultBytes = 0n;

  add(p: Progress): void {
    this.total.read_rows += p.read_rows;
    this.total.read_bytes += p.read_bytes;
    this.total.total_rows_to_read += p.total_rows_to_read;
    this.total.total_bytes_to_read += p.total_bytes_to_read;
    this.total.written_rows += p.written_rows;
    this.total.written_bytes += p.written_bytes;
    // elapsed_ns is the time since the start of the query
    if (p.elapsed_ns > this.total.elapsed_ns) {
      this.total.elapsed_ns = p.elapsed_ns;
    }
  }

  /** Counts the inserted rows from the profile events. The server sends no
   *  Progress packets for some inserts (for example, async inserts). */
  profileEvents(block: Block): void {
    const column = (name: string) =>
      block.columns.find((c) => c.name === name)?.values;
    const names = column("name");
    const values = column("value");
    const threads = column("thread_id");
    if (names === undefined || values === undefined) return;
    for (let i = 0; i < block.rows; i++) {
      // Thread 0 has the totals of the query.
      if (threads !== undefined && Number(threads[i]) !== 0) continue;
      if (names[i] === "InsertedRows")
        this.insertedRows += BigInt(values[i] as number | bigint);
      if (names[i] === "InsertedBytes")
        this.insertedBytes += BigInt(values[i] as number | bigint);
      if (names[i] === "AsyncInsertBytes")
        this.insertedBytes += BigInt(values[i] as number | bigint);
    }
  }

  /** Rows that the client sent in Native blocks: the written rows when the
   *  server does not count them (async inserts). */
  addSentRows(rows: number): void {
    this.sentRows += BigInt(rows);
  }

  profile(info: ProfileInfo): void {
    this.resultRows = info.rows;
    this.resultBytes = info.bytes;
  }

  totals(): Progress {
    return this.total;
  }

  summary(): ClickHouseSummary {
    return {
      read_rows: String(this.total.read_rows),
      read_bytes: String(this.total.read_bytes),
      written_rows: String(
        this.total.written_rows || this.insertedRows || this.sentRows,
      ),
      written_bytes: String(this.total.written_bytes || this.insertedBytes),
      total_rows_to_read: String(this.total.total_rows_to_read),
      result_rows: String(this.resultRows),
      result_bytes: String(this.resultBytes),
      elapsed_ns: String(this.total.elapsed_ns),
    };
  }
}
