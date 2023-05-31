const webpackConfig = require('./webpack.config.js')

module.exports = function (config) {
  config.set({
    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',
    frameworks: ['webpack', 'jasmine'],
    // list of files / patterns to load in the browser
    files: [
      'karma.setup.cjs',
      '__tests__/unit/*.test.ts',
      '__tests__/integration/auth.test.ts',
      '__tests__/integration/select.test.ts',
      '__tests__/integration/select_result.test.ts',
      // '__tests__/integration/config.test.ts',
      '__tests__/utils/*.ts',
    ],
    exclude: [],
    webpack: webpackConfig,
    preprocessors: {
      'packages/client-common/**/*.ts': ['webpack'],
      'packages/client-browser/**/*.ts': ['webpack'],
      '__tests__/unit/*.test.ts': ['webpack'],
      '__tests__/integration/auth.test.ts': ['webpack'],
      '__tests__/integration/select.test.ts': ['webpack'],
      '__tests__/integration/select_result.test.ts': ['webpack'],
      // '__tests__/integration/config.test.ts': ['webpack'],
      '__tests__/utils/*.ts': ['webpack'],
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
  })
}
