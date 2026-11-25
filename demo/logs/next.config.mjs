import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The decoder is a regular Node dependency we want to require at runtime on the
  // server, not bundle/trace into the server build. Keep it external.
  serverExternalPackages: ["@clickhouse/rowbinary"],
  // This demo lives inside the clickhouse-js monorepo, which has its own
  // lockfiles higher up. Pin the tracing root to this app so Next doesn't infer
  // the wrong workspace root.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
};

export default nextConfig;
