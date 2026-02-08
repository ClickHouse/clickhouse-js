console.log('Setting up Node.js test environment...')

import { createClient } from '@clickhouse/client-node'

/**
 * This file is used to set up the test environment for Vitest when running tests in Node.js.
 */
globalThis.environmentSpecificCreateClient = createClient
