import { execSync } from 'child_process'
import fs from 'fs'
import * as process from 'process'

void (async () => {
  const [pkg] = process.argv.slice(2)
  if (!pkg) {
    console.error(`Expected package name as an argument`)
    process.exit(1)
  }

  let packageName = ''
  if (pkg.endsWith('web')) {
    packageName = 'client-web'
  } else if (pkg.endsWith('node')) {
    packageName = 'client-node'
  } else if (pkg.endsWith('common')) {
    packageName = 'client-common'
  } else {
    console.error(`Provided tag ${pkg} does not match any packages`)
    process.exit(1)
  }

  fs.copyFileSync(`./packages/${packageName}/package.json`, './package.json')

  const packageJson = (await import('../package.json').then(
    (m) => m.default,
  )) as any
  const version = (
    await import(`../packages/${packageName}/src/version` + '.ts')
  ).default
  console.log(`Current ${packageName} package version is: ${version}`)
  packageJson.version = version

  if (packageJson.dependencies['@clickhouse/client-common']) {
    const commonVersion = (
      await import('../packages/client-common/src/version' + '.ts')
    ).default
    console.log(`Updating client-common dependency to ${commonVersion}`)
    packageJson['dependencies']['@clickhouse/client-common'] = commonVersion
  }

  console.log('Updated package json:')
  console.log(packageJson)

  try {
    execSync(`./.scripts/build.sh ${packageName}`, { cwd: process.cwd() })
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  try {
    fs.writeFileSync(
      './package.json',
      JSON.stringify(packageJson, null, 2) + '\n',
      'utf-8',
    )
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
  process.exit(0)
})()
