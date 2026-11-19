import { describe, expect, it } from "vitest";
import { parseArgs, resolveHttpPort } from "../src/args.js";
import { SERVER_SETTINGS } from "../src/settings.js";

describe("resolveHttpPort", () => {
  it("maps the native TCP port the upstream runner passes to the HTTP port", () => {
    expect(resolveHttpPort(9000, false, {})).toBe(8123);
    expect(resolveHttpPort(9440, true, {})).toBe(8443);
  });

  it("follows the ports the runner exports", () => {
    const env = { CLICKHOUSE_PORT_TCP: "19000", CLICKHOUSE_PORT_HTTP: "18123" };
    expect(resolveHttpPort(19000, false, env)).toBe(18123);
    // 9000 is not the native port in this environment, so it is used as is.
    expect(resolveHttpPort(9000, false, env)).toBe(9000);
  });

  it("keeps any other port as an HTTP port", () => {
    expect(resolveHttpPort(8123, false, {})).toBe(8123);
    expect(resolveHttpPort(18123, false, {})).toBe(18123);
  });
});

describe("parseArgs", () => {
  it("returns defaults for an empty argv", () => {
    const args = parseArgs([]);
    expect(args.host).toBe("localhost");
    expect(args.port).toBe(8123);
    expect(args.user).toBe("default");
    expect(args.password).toBe("");
    expect(args.database).toBe("default");
    expect(args.multiquery).toBe(false);
    expect(args.secure).toBe(false);
    expect(args.query).toBeNull();
    expect(args.help).toBe(false);
    expect(args.logComment).toBeNull();
    expect(args.sendLogsLevel).toBeNull();
    expect(args.maxInsertThreads).toBeNull();
    expect(args.serverSettings).toEqual({});
  });

  it("parses long-form options with separate values", () => {
    const args = parseArgs([
      "--host",
      "other",
      "--port",
      "9000",
      "--user",
      "u",
      "--password",
      "p",
      "--database",
      "d",
    ]);
    expect(args.host).toBe("other");
    expect(args.port).toBe(9000);
    expect(args.user).toBe("u");
    expect(args.password).toBe("p");
    expect(args.database).toBe("d");
  });

  it("parses long-form options with = form", () => {
    const args = parseArgs([
      "--host=other",
      "--port=9000",
      "--user=u",
      "--password=p",
      "--database=d",
    ]);
    expect(args.host).toBe("other");
    expect(args.port).toBe(9000);
    expect(args.user).toBe("u");
    expect(args.password).toBe("p");
    expect(args.database).toBe("d");
  });

  it("parses short options including -q and -s", () => {
    const args = parseArgs([
      "-h",
      "other",
      "-u",
      "u",
      "-d",
      "d",
      "-q",
      "SELECT 1",
      "-s",
    ]);
    expect(args.host).toBe("other");
    expect(args.user).toBe("u");
    expect(args.database).toBe("d");
    expect(args.query).toBe("SELECT 1");
    expect(args.secure).toBe(true);
  });

  it("accepts --multiquery, --multi-query and -n", () => {
    expect(parseArgs(["--multiquery"]).multiquery).toBe(true);
    expect(parseArgs(["--multi-query"]).multiquery).toBe(true);
    // As in clickhouse-client, `-n` is `--multiquery`, not `--multiline`.
    expect(parseArgs(["-n"]).multiquery).toBe(true);
  });

  it("silently accepts --multiline and -m", () => {
    expect(() => parseArgs(["--multiline"])).not.toThrow();
    expect(() => parseArgs(["-m"])).not.toThrow();
    const a = parseArgs(["--multiline", "-m"]);
    expect(a.multiquery).toBe(false);
    expect(a.serverSettings).toEqual({});
    expect(a.query).toBeNull();
  });

  it("sets help=true for --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  it("accepts both underscore and dash forms for log_comment", () => {
    expect(parseArgs(["--log_comment", "foo"]).logComment).toBe("foo");
    expect(parseArgs(["--log-comment", "foo"]).logComment).toBe("foo");
  });

  it("accepts both forms for send_logs_level", () => {
    expect(parseArgs(["--send_logs_level", "trace"]).sendLogsLevel).toBe(
      "trace",
    );
    expect(parseArgs(["--send-logs-level", "trace"]).sendLogsLevel).toBe(
      "trace",
    );
  });

  it("accepts both forms for max_insert_threads", () => {
    expect(parseArgs(["--max_insert_threads", "8"]).maxInsertThreads).toBe("8");
    expect(parseArgs(["--max-insert-threads", "8"]).maxInsertThreads).toBe("8");
  });

  it("routes --max_insert_threads=8 into the explicit field, not serverSettings", () => {
    const a = parseArgs(["--max_insert_threads=8"]);
    expect(a.maxInsertThreads).toBe("8");
    expect(a.serverSettings).toEqual({});
  });

  it("exports a non-empty SERVER_SETTINGS allowlist", () => {
    expect(SERVER_SETTINGS).toBeInstanceOf(Set);
    expect(SERVER_SETTINGS.size).toBeGreaterThan(0);
  });

  it("silently drops unknown options", () => {
    const a = parseArgs(["--brand-new-thing=xyz"]);
    expect(a.serverSettings).toEqual({});
    expect(a.query).toBeNull();
  });

  it("forwards --max_threads=4 as a server setting", () => {
    const a = parseArgs(["--max_threads=4"]);
    expect(a.serverSettings).toEqual({ max_threads: "4" });
    expect(a.query).toBeNull();
  });

  it("silently drops a CLIENT_ONLY setting like --max_block_size=1024", () => {
    const a = parseArgs(["--max_block_size=1024"]);
    expect(a.serverSettings).toEqual({});
    expect(a.query).toBeNull();
  });

  it("does not place --unknown_thing=42 into serverSettings or throw", () => {
    expect(() => parseArgs(["--unknown_thing=42"])).not.toThrow();
    const a = parseArgs(["--unknown_thing=42"]);
    expect(a.serverSettings).toEqual({});
  });

  it("treats --max-threads=4 the same as --max_threads=4 (forwarded as server setting)", () => {
    const a = parseArgs(["--max-threads=4"]);
    expect(a.serverSettings).toEqual({ max_threads: "4" });
  });
});
