// @ts-nocheck
import { createClient } from '@clickhouse/client-web'

/**
 * This file is used to set up the test environment for Vitest when running tests in Node.js.
 */
globalThis.environmentSpecificCreateClient = createClient

globalThis.process = {
  env: {
    BROWSER: 'chromium',
  },
}
