import { type BackendOptions, Session } from "./shared.js";

/**
 * Passthrough backend (the default) and native backend: copy the
 * `TabSeparated` output to stdout. Over HTTP the client only transports
 * bytes and ClickHouse writes the text. The native client formats the text
 * from Native blocks. `default_format = TabSeparated` selects it, so the
 * query text is sent as it is.
 */
export async function executeWithClient(
  opts: BackendOptions,
  backend: "passthrough" | "native" = "passthrough",
): Promise<void> {
  const session = new Session(
    opts.args,
    opts.logPath,
    backend === "native" ? "native" : "http",
  );
  await session.run(opts.statements, async (sql) => {
    const query_params = session.queryParams(sql);
    const native = session.native;
    const result =
      native !== null
        ? await native.exec({
            query: sql,
            clickhouse_settings: session.plainRequestSettings("TabSeparated"),
            query_params,
          })
        : await session.current.exec({
            query: sql,
            clickhouse_settings: session.requestSettings("TabSeparated"),
            query_params,
          });
    return async () => {
      for await (const chunk of result.stream) {
        process.stdout.write(chunk);
      }
    };
  });
}
