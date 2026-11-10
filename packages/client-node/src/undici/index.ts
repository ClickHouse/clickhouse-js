/**
 * The `@clickhouse/client/undici` entry point. It is separate from the main
 * entry point, so that `undici` (an optional peer dependency) is loaded only
 * when a user imports this module.
 */
export {
  undiciTransport,
  type UndiciTransportOptions,
} from "./undici_transport";
