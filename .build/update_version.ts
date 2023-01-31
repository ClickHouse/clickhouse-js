import version from '../src/version'
import packageJson from '../package.json'
import fs from 'fs'
;(async () => {
  console.log(`Current package version is: ${version}`)
  packageJson.version = version
  console.log('Updated package json:')
  console.log(packageJson)
  try {
    fs.writeFileSync(
      './package.json',
      JSON.stringify(packageJson, null, 2) + '\n',
      'utf-8'
    )
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
  process.exit(0)
})()
