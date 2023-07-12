const webpackConfig = require('./webpack.config.js')

module.exports = function (config) {
  config.set({
    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',
    frameworks: ['webpack', 'jasmine'],
    // list of files / patterns to load in the browser
    files: [
      '__tests__/integration/*.test.ts',
      '__tests__/integration/browser/*.test.ts',
      '__tests__/utils/*.ts',
      '__tests__/unit/*.test.ts',
      '__tests__/unit/browser/*.test.ts',
    ],
    exclude: [],
    webpack: webpackConfig,
    preprocessors: {
      'packages/client-common/**/*.ts': ['webpack', 'sourcemap'],
      'packages/client-browser/**/*.ts': ['webpack', 'sourcemap'],
      '__tests__/unit/*.test.ts': ['webpack', 'sourcemap'],
      '__tests__/unit/browser/*.test.ts': ['webpack', 'sourcemap'],
      '__tests__/integration/*.ts': ['webpack', 'sourcemap'],
      '__tests__/integration/browser/*.ts': ['webpack', 'sourcemap'],
      '__tests__/utils/*.ts': ['webpack', 'sourcemap'],
    },
    reporters: ['progress'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: false,
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    browsers: ['Chrome_without_security'],
    customLaunchers: {
      Chrome_without_security: {
        base: 'ChromeHeadless',
        // to disable CORS
        flags: ['--disable-web-security'],
      },
    },
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: true,
    client: {
      jasmine: {
        random: false,
        stopOnSpecFailure: false,
        stopSpecOnExpectationFailure: true,
        timeoutInterval: 5000,
      }
    }
  })
}
