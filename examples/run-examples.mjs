/**
 * Runs all compatible examples against a running ClickHouse instance.
 *
 * Usage: node run-examples.mjs
 *
 * Optional environment variables:
 *  CLICKHOUSE_URL      - URL of the ClickHouse instance (default: http://localhost:8123)
 *  CLICKHOUSE_PASSWORD - Password for the ClickHouse instance (default: empty)
 *
 * Examples that require special infrastructure are skipped automatically:
 *  - TLS examples    (require certificates and a special ClickHouse TLS instance)
 *  - Cluster examples (require a multi-node ClickHouse cluster)
 *  - Cloud examples   (require ClickHouse Cloud credentials)
 *  - Long-running examples (designed for production demo purposes, take 300–400 s)
 *
 * Examples designed to run indefinitely (e.g. event-driven inserts) are started,
 * allowed to run for a few seconds to verify they work, then gracefully stopped.
 * If ClickHouse is not reachable, the script exits with a non-zero status code.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TSX = resolve(__dirname, 'node_modules', '.bin', 'tsx')

if (!existsSync(TSX)) {
  console.error(
    'tsx not found. Please run "npm install" in the examples directory first.',
  )
  process.exit(1)
}

/**
 * Examples that cannot be run in a standard single-node CI environment.
 * These are skipped with a note.
 */
const SKIPPED_EXAMPLES = new Set([
  // Requires ClickHouse Cloud credentials (CLICKHOUSE_URL + CLICKHOUSE_PASSWORD env vars pointing to Cloud)
  'create_table_cloud.ts',
  // Requires a multi-node ClickHouse cluster (docker-compose.cluster.yml)
  'create_table_on_premise_cluster.ts',
  // Requires TLS certificates and a special ClickHouse TLS instance
  'node/basic_tls.ts',
  'node/mutual_tls.ts',
  // Designed as a production-scenario demo; intentionally uses very long timeouts (up to 400 s)
  'long_running_queries_timeouts.ts',
])

/**
 * Examples that are designed to run indefinitely (event-driven or continuous inserts).
 * These are started, run for a short period to verify they work correctly, then stopped via SIGTERM.
 */
const INFINITE_EXAMPLES = new Set([
  'async_insert_without_waiting.ts',
  'node/insert_streaming_with_backpressure.ts',
])

/** How long (ms) to let "infinite" examples run before stopping them. */
const INFINITE_EXAMPLE_RUN_MS = 5_000

/** Timeout (ms) for examples expected to complete on their own. */
const DEFAULT_TIMEOUT_MS = 60_000

/** All examples to attempt, in the order they appear in the README. */
const ALL_EXAMPLES = [
  // General usage
  'abort_request.ts',
  'async_insert.ts',
  'async_insert_without_waiting.ts',
  'cancel_query.ts',
  'clickhouse_settings.ts',
  'create_table_cloud.ts',
  'create_table_on_premise_cluster.ts',
  'create_table_single_node.ts',
  'custom_json_handling.ts',
  'default_format_setting.ts',
  'dynamic_variant_json.ts',
  'insert_data_formats_overview.ts',
  'insert_decimals.ts',
  'insert_ephemeral_columns.ts',
  'insert_exclude_columns.ts',
  'insert_from_select.ts',
  'insert_into_different_db.ts',
  'insert_js_dates.ts',
  'insert_values_and_functions.ts',
  'long_running_queries_timeouts.ts',
  'ping.ts',
  'query_with_parameter_binding.ts',
  'read_only_user.ts',
  'role.ts',
  'select_data_formats_overview.ts',
  'select_json_each_row.ts',
  'select_json_with_metadata.ts',
  'session_id_and_temporary_tables.ts',
  'session_level_commands.ts',
  'time_time64.ts',
  'url_configuration.ts',
  // Node.js-specific
  'node/basic_tls.ts',
  'node/insert_arbitrary_format_stream.ts',
  'node/insert_file_stream_csv.ts',
  'node/insert_file_stream_ndjson.ts',
  'node/insert_file_stream_parquet.ts',
  'node/insert_streaming_backpressure_simple.ts',
  'node/insert_streaming_with_backpressure.ts',
  'node/mutual_tls.ts',
  'node/select_json_each_row_with_progress.ts',
  'node/select_parquet_as_file.ts',
  'node/select_streaming_json_each_row.ts',
  'node/select_streaming_json_each_row_for_await.ts',
  'node/select_streaming_text_line_by_line.ts',
  'node/stream_created_from_array_raw.ts',
]

function runExample(examplePath, { timeoutMs, stopAfterMs } = {}) {
  return new Promise((resolve) => {
    const fullPath = new URL(examplePath, import.meta.url).pathname
    const child = spawn(TSX, [fullPath], {
      cwd: __dirname,
      env: process.env,
      stdio: 'pipe',
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))

    // For "infinite" examples: stop via SIGTERM after the allowed run period
    let stopTimer = null
    if (stopAfterMs !== undefined) {
      stopTimer = setTimeout(() => {
        child.kill('SIGTERM')
      }, stopAfterMs)
    }

    // Hard timeout to prevent a stuck example from blocking the whole run
    const hardTimer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs ?? DEFAULT_TIMEOUT_MS)

    child.on('close', (code, signal) => {
      clearTimeout(stopTimer)
      clearTimeout(hardTimer)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

async function main() {
  let passed = 0
  let failed = 0
  let skipped = 0

  for (const example of ALL_EXAMPLES) {
    if (SKIPPED_EXAMPLES.has(example)) {
      console.log(`⏭  SKIP  ${example}`)
      skipped++
      continue
    }

    const isInfinite = INFINITE_EXAMPLES.has(example)
    process.stdout.write(`▶  RUN   ${example} ... `)

    const { code, signal, stdout, stderr } = await runExample(example, {
      stopAfterMs: isInfinite ? INFINITE_EXAMPLE_RUN_MS : undefined,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })

    // An "infinite" example that was stopped by our SIGTERM is considered a success.
    // It exits with code null and signal 'SIGTERM' (before the process handles it)
    // or with code 0 if the process handled SIGTERM and called process.exit(0).
    const success =
      code === 0 || (isInfinite && (signal === 'SIGTERM' || code === 0))

    if (success) {
      console.log('✅ PASS')
      passed++
    } else {
      console.log(`❌ FAIL (exit code: ${code}, signal: ${signal})`)
      console.error('--- stdout ---')
      console.error(stdout)
      console.error('--- stderr ---')
      console.error(stderr)
      failed++
    }
  }

  console.log(`\n========================================`)
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`)
  console.log(`========================================`)

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
