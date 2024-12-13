const webpackConfig = require('./webpack.dev.js')

const TEST_TIMEOUT_MS = 400_000

module.exports = function (config) {
  config.set({
    // base path that will be used to resolve all patterns (e.g. files, exclude)
    basePath: '',
    frameworks: ['webpack', 'jasmine'],
    // list of files / patterns to load in the browser
    files: ['packages/client-web/__tests__/jwt/*.test.ts'],
    exclude: [],
    webpack: webpackConfig,
    preprocessors: {
      'packages/client-common/**/*.ts': ['webpack', 'sourcemap'],
      'packages/client-web/**/*.ts': ['webpack', 'sourcemap'],
      'packages/client-common/__tests__/jwt/*.ts': ['webpack', 'sourcemap'],
      'packages/client-common/__tests__/utils/*.ts': ['webpack', 'sourcemap'],
    },
    reporters: ['mocha'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: false,
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    browsers: ['ChromeHeadless', 'FirefoxHeadless'],
    browserNoActivityTimeout: TEST_TIMEOUT_MS,
    browserDisconnectTimeout: TEST_TIMEOUT_MS,
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: true,
    client: {
      jasmine: {
        random: false,
        stopOnSpecFailure: false,
        stopSpecOnExpectationFailure: true,
        timeoutInterval: TEST_TIMEOUT_MS,
      },
    },
  })
}
