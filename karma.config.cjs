const webpackConfig = require('./webpack.dev.js')

module.exports = function (config) {
  config.set({
    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',
    frameworks: ['webpack', 'jasmine'],
    // list of files / patterns to load in the browser
    files: [
      'packages/client-common/__tests__/unit/*.test.ts',
      'packages/client-common/__tests__/utils/*.ts',
      'packages/client-common/__tests__/integration/*.test.ts',
      'packages/client-browser/__tests__/integration/*.test.ts',
      'packages/client-browser/__tests__/unit/*.test.ts',
    ],
    exclude: [],
    webpack: webpackConfig,
    preprocessors: {
      'packages/client-common/**/*.ts': ['webpack', 'sourcemap'],
      'packages/client-browser/**/*.ts': ['webpack', 'sourcemap'],
      'packages/client-common/__tests__/unit/*.test.ts': [
        'webpack',
        'sourcemap',
      ],
      'packages/client-common/__tests__/integration/*.ts': [
        'webpack',
        'sourcemap',
      ],
      'packages/client-common/__tests__/utils/*.ts': ['webpack', 'sourcemap'],
      'packages/client-browser/__tests__/unit/*.test.ts': [
        'webpack',
        'sourcemap',
      ],
      'packages/client-browser/__tests__/integration/*.ts': [
        'webpack',
        'sourcemap',
      ],
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
        timeoutInterval: 30000,
      },
    },
  })
}
