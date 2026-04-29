'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

function check(description, fn) {
  try {
    fn()
    console.log(`ok: ${description}`)
  } catch (e) {
    console.error(`FAIL: ${description}`)
    console.error(e.message)
    process.exit(1)
  }
}

const nm = path.join(__dirname, 'node_modules')

// @clickhouse/client (Node.js)
const nodeRoot = path.join(nm, '@clickhouse', 'client')
const nodeSkillRoot = path.join(nodeRoot, 'skills', 'clickhouse-js-node-troubleshooting')

check('@clickhouse/client skills dir exists', () =>
  assert.ok(fs.existsSync(path.join(nodeRoot, 'skills')))
)
check('@clickhouse/client SKILL.md exists', () =>
  assert.ok(fs.existsSync(path.join(nodeSkillRoot, 'SKILL.md')))
)
check('@clickhouse/client package.json declares agents.skills', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(nodeRoot, 'package.json'), 'utf8'))
  assert.ok(Array.isArray(pkg.agents?.skills), 'agents.skills should be an array')
  assert.ok(
    pkg.agents.skills.some((s) => s.name === 'clickhouse-js-node-troubleshooting'),
    'agents.skills should include clickhouse-js-node-troubleshooting'
  )
})

// @clickhouse/client-web — no skills yet; verify the package installed cleanly and does not ship skills
check('@clickhouse/client-web installs without skills dir', () => {
  const webRoot = path.join(nm, '@clickhouse', 'client-web')
  assert.ok(fs.existsSync(webRoot), '@clickhouse/client-web should be installed')
  assert.ok(
    !fs.existsSync(path.join(webRoot, 'skills')),
    '@clickhouse/client-web should not include a skills directory'
  )
})

console.log('\nAll checks passed.')
