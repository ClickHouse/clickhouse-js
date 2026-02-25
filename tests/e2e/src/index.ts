const assert = require('assert')
const { createClient } = require('@clickhouse/client')
const version = require('@clickhouse/client/dist/version')

async function main() {
  const tags = await (
    await fetch(
      'https://registry.npmjs.org/-/package/@clickhouse/client/dist-tags',
    )
  ).json()

  console.log(`Latest beta version on npm: ${tags.beta}`)

  assert.strictEqual(
    version.default,
    tags.beta,
    'Version should be the latest beta version on npm',
  )

  assert.strictEqual(
    typeof createClient,
    'function',
    'createClient should be a function',
  )
  assert.ok(createClient(), 'createClient should return a client instance')
}

main()
