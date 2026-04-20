const assert = require('assert')
const { createClient } = require('@clickhouse/client')
const version = require('@clickhouse/client/dist/version')

async function main() {
  const tags = await (
    await fetch(
      'https://registry.npmjs.org/-/package/@clickhouse/client/dist-tags',
    )
  ).json()

  console.log(`Latest "latest" version on npm: ${tags.latest}`)

  assert.strictEqual(
    version.default,
    tags.latest,
    'Version should be the latest "latest" version on npm',
  )

  assert.strictEqual(
    typeof createClient,
    'function',
    'createClient should be a function',
  )
  assert.ok(createClient(), 'createClient should return a client instance')
}

main()
