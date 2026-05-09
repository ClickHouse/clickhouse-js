'use strict'

// E2E packaging check for shipped AI-agent skills.
//
// Source of truth: the repo-root `skills/` directory. Every skill that lives
// there is shipped via `@clickhouse/client` (its `prepack` copies the entire
// `skills/` tree into the package), so this script discovers skills from the
// source directory and asserts that each one is:
//
//   1. declared in `agents.skills` of the installed @clickhouse/client
//      package.json (with matching `path`),
//   2. present at the declared path inside the installed package and contains
//      a `SKILL.md`,
//   3. symlinked into `.claude/skills/` by skills-npm.
//
// It also asserts that `agents.skills` does not declare any skill that is
// missing from the source `skills/` directory, and that `@clickhouse/client-web`
// ships no skills.

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
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const skillsSrcDir = path.join(repoRoot, 'skills')

// Discover skills from the source-of-truth `skills/` directory.
assert.ok(
  fs.existsSync(skillsSrcDir),
  `source-of-truth skills directory not found at ${skillsSrcDir}; this script is meant to run from tests/e2e/skills inside the clickhouse-js repo`,
)
const expectedSkills = fs
  .readdirSync(skillsSrcDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(skillsSrcDir, d.name, 'SKILL.md')))
  .map((d) => d.name)
  .sort()

check('repo skills/ directory contains at least one skill', () => {
  assert.ok(
    expectedSkills.length > 0,
    `expected at least one skill under ${skillsSrcDir}`,
  )
})

// @clickhouse/client (Node.js) — ships every skill from the repo `skills/` tree.
const nodeRoot = path.join(nm, '@clickhouse', 'client')
const nodePkg = JSON.parse(
  fs.readFileSync(path.join(nodeRoot, 'package.json'), 'utf8'),
)
const declaredSkills = Array.isArray(nodePkg.agents?.skills)
  ? nodePkg.agents.skills
  : []

check('@clickhouse/client skills dir exists', () =>
  assert.ok(fs.existsSync(path.join(nodeRoot, 'skills'))),
)

check(
  '@clickhouse/client agents.skills declares every skill from skills/',
  () => {
    const declaredNames = declaredSkills.map((s) => s.name).sort()
    assert.deepStrictEqual(
      declaredNames,
      expectedSkills,
      `agents.skills (${JSON.stringify(declaredNames)}) must match the skills found under skills/ (${JSON.stringify(expectedSkills)})`,
    )
  },
)

for (const skill of declaredSkills) {
  check(
    `@clickhouse/client agents.skills entry "${skill.name}" has a valid path`,
    () => {
      assert.ok(
        typeof skill.path === 'string' && skill.path.length > 0,
        `agents.skills entry for ${skill.name} must declare a "path"`,
      )
      const expectedPath = `./skills/${skill.name}`
      assert.strictEqual(
        skill.path,
        expectedPath,
        `agents.skills entry for ${skill.name} should declare path "${expectedPath}"`,
      )
      const resolved = path.join(nodeRoot, skill.path)
      assert.ok(
        fs.existsSync(resolved),
        `declared skill path does not exist in installed package: ${skill.path}`,
      )
      assert.ok(
        fs.existsSync(path.join(resolved, 'SKILL.md')),
        `declared skill at ${skill.path} should contain SKILL.md`,
      )
    },
  )
}

// @clickhouse/client-web — no skills yet; verify the package installed cleanly and does not ship skills
check('@clickhouse/client-web installs without skills dir', () => {
  const webRoot = path.join(nm, '@clickhouse', 'client-web')
  assert.ok(
    fs.existsSync(webRoot),
    '@clickhouse/client-web should be installed',
  )
  assert.ok(
    !fs.existsSync(path.join(webRoot, 'skills')),
    '@clickhouse/client-web should not include a skills directory',
  )
})

// skills-npm — symlinks each declared skill under `.claude/skills/`.
const skillsLinkDir = path.join(__dirname, '.claude', 'skills')

check('skills-npm creates a skills/ directory', () => {
  assert.ok(
    fs.existsSync(skillsLinkDir),
    'skills/ directory should be created by skills-npm',
  )
})

const npmLinks = () =>
  fs.existsSync(skillsLinkDir)
    ? fs.readdirSync(skillsLinkDir).filter((e) => e.startsWith('npm-'))
    : []

check('skills-npm creates at least one npm-* symlink', () => {
  const links = npmLinks()
  assert.ok(
    links.length > 0,
    'skills/ should contain at least one npm-* symlink',
  )
})

for (const skill of declaredSkills) {
  check(`skills-npm symlinks ${skill.name}`, () => {
    const links = npmLinks()
    const link = links.find((e) => e.includes(skill.name))
    assert.ok(
      link,
      `skills/ should contain a symlink for ${skill.name}, found: [${links.join(', ')}]`,
    )
    const linkPath = path.join(skillsLinkDir, link)
    assert.ok(
      fs.lstatSync(linkPath).isSymbolicLink(),
      `${link} should be a symlink`,
    )
    assert.ok(
      fs.existsSync(path.join(linkPath, 'SKILL.md')),
      `symlinked skill ${skill.name} should contain SKILL.md`,
    )
  })
}

console.log('\nAll checks passed.')
