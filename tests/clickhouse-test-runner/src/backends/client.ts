import { type BackendOptions, Session } from "./shared.js";

/**
 * Passthrough backend (the default): copy ClickHouse's own `TabSeparated`
 * output to stdout. The client only transports bytes; ClickHouse writes the
 * text. `default_format = TabSeparated` selects it, so the query text is sent
 * as it is.
 */
export async function executeWithClient(opts: BackendOptions): Promise<void> {
  const session = new Session(opts.args, opts.logPath);
  await session.run(opts.statements, async (sql) => {
    const result = await session.current.exec({
      query: sql,
      clickhouse_settings: session.requestSettings("TabSeparated"),
      query_params: session.queryParams(sql),
    });
    return async () => {
      for await (const chunk of result.stream) {
        process.stdout.write(chunk);
      }
    };
  });
}
