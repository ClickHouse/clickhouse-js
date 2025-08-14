import * as os from 'node:os'
import packageVersion from '../version'

/** Indirect export of package version and node version for easier mocking since Node.js 22.18 */
export class Runtime {
  static package = packageVersion
  static node = process.version
  static os = os.platform()
}
