import { fetchLogsPage, type LogsPage } from "@/lib/logs";

// This page hits ClickHouse on every request and must never be statically
// prerendered or cached — it is a live, server-rendered view.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function fmtTime(d: Date): string {
  // YYYY-MM-DD HH:MM:SS.mmm
  return d.toISOString().replace("T", " ").replace("Z", "");
}

export default async function LogsPageView({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam ?? "1");

  let data: LogsPage | null = null;
  let failed = false;
  try {
    data = await fetchLogsPage(page, PAGE_SIZE);
  } catch (e) {
    // The underlying error can carry ClickHouse SQL/server details, so log it
    // server-side and show the user a generic message instead.
    console.error("fetchLogsPage failed:", e);
    failed = true;
  }

  return (
    <main>
      <header>
        <h1>RowBinary Logs</h1>
        <p>
          Server-rendered from ClickHouse, decoded with{" "}
          <code>@clickhouse/rowbinary</code>. The browser only receives HTML —
          all decoding happens in <code>lib/logs.ts</code> on the server.
        </p>
      </header>

      {failed || !data ? (
        <EmptyState message="Couldn't load logs from ClickHouse." />
      ) : data.total === 0 ? (
        <EmptyState message="The demo_logs table is empty." />
      ) : (
        <LogsTable data={data} />
      )}
    </main>
  );
}

function LogsTable({ data }: { data: LogsPage }) {
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Level</th>
            <th>Service</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Host</th>
            <th>Trace ID</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            // Real logs can share a trace across rows; combine with the
            // timestamp to keep React keys unique.
            <tr key={`${row.traceId}-${row.timestamp.getTime()}`}>
              <td className="mono">{fmtTime(row.timestamp)}</td>
              <td>
                <span className={`level ${row.level}`}>{row.level}</span>
              </td>
              <td>{row.service}</td>
              <td className="mono">{row.status}</td>
              <td className="mono">{row.durationMs.toFixed(1)} ms</td>
              <td className="mono">{row.host}</td>
              <td className="mono">{row.traceId.slice(0, 8)}…</td>
              <td className="msg">{row.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager data={data} />
    </>
  );
}

function Pager({ data }: { data: LogsPage }) {
  const { page, totalPages, total } = data;
  const hasPrev = page > 1;
  const hasNext = page < totalPages;
  return (
    <nav className="pager">
      {hasPrev ? (
        <a href={`/?page=${page - 1}`}>← Newer</a>
      ) : (
        <span className="disabled">← Newer</span>
      )}
      {hasNext ? (
        <a href={`/?page=${page + 1}`}>Older →</a>
      ) : (
        <span className="disabled">Older →</span>
      )}
      <span className="status">
        Page {page} of {totalPages} · {total.toLocaleString()} rows
      </span>
    </nav>
  );
}

function EmptyState({ message }: { message?: string | null }) {
  return (
    <div className="empty">
      <p>No logs to show{message ? `: ${message}` : "."}</p>
      <p>Make sure ClickHouse is running and the table is seeded:</p>
      <pre>{`# from demo/logs\ndocker compose up -d\nnpm run seed`}</pre>
    </div>
  );
}
