const webpackConfig = require('./webpack.config.js');

module.exports = function (config) {
  config.set({
    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',

    frameworks: ['mocha', 'chai', 'webpack'],

    // list of files / patterns to load in the browser
    files: ['__tests__/**/*.test.ts'],

    exclude: [],

    webpack: webpackConfig,

    preprocessors: {
      'src/**/*.ts': ['webpack'],
      '__tests__/**/*.test.ts': ['webpack'],
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
  });
};
