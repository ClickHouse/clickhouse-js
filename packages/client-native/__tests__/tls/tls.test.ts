import * as fs from "fs";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "../../src";
import type { ClickHouseClient } from "../../src";

/**
 * Needs the `clickhouse_tls` service of docker-compose.yml (native TLS port
 * 9440), and `127.0.0.1 server.clickhouseconnect.test` in /etc/hosts, as the
 * TLS tests of the node client.
 */
describe("[Native] TLS connection", () => {
  let client: ClickHouseClient | undefined;
  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  const certsPath = ".docker/clickhouse/single_node_tls/certificates";
  const ca_cert = fs.readFileSync(`${certsPath}/ca.crt`);
  const cert = fs.readFileSync(`${certsPath}/client.crt`);
  const key = fs.readFileSync(`${certsPath}/client.key`);

  it("should work with basic TLS", async () => {
    client = createClient({
      url: "tcps://server.clickhouseconnect.test:9440",
      tls: { ca_cert },
    });
    const rs = await client.query({
      query: "SELECT number FROM system.numbers LIMIT 3",
      format: "CSV",
    });
    expect(await rs.text()).toEqual("0\n1\n2\n");
  });

  it("should work with mutual TLS", async () => {
    client = createClient({
      url: "tcps://server.clickhouseconnect.test:9440",
      username: "cert_user",
      tls: { ca_cert, cert, key },
    });
    const rs = await client.query({
      query: "SELECT currentUser() AS u",
      format: "JSONEachRow",
    });
    expect(await rs.json()).toEqual([{ u: "cert_user" }]);
  });

  it("should fail when the hostname does not match", async () => {
    client = createClient({
      url: "tcps://localhost:9440",
      tls: { ca_cert },
    });
    await expect(client.query({ query: "SELECT 1" })).rejects.toThrow(
      "Hostname/IP does not match certificate's altnames",
    );
  });

  it("should fail with an unknown certificate authority", async () => {
    client = createClient({ url: "tcps://server.clickhouseconnect.test:9440" });
    await expect(client.query({ query: "SELECT 1" })).rejects.toThrow();
  });
});
