// see https://github.com/facebook/jest/issues/4156#issuecomment-757376195
const { DefaultReporter } = require('@jest/reporters')

class Reporter extends DefaultReporter {
  constructor() {
    super(...arguments)
  }

  // Print console logs only for __failed__ test __files__
  // Unfortunately, it does not seem possible to extract logs
  // from a particular test __case__ in a clean way without too much hacks
  printTestFileHeader(_testPath, config, result) {
    const console = result.console
    if (result.numFailingTests === 0 && !result.testExecError) {
      result.console = null
    }
    super.printTestFileHeader(...arguments)
    result.console = console
  }
}

module.exports = Reporter
