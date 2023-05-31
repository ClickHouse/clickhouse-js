const webpack = require('webpack')
const path = require('path')
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin')
module.exports = {
  entry: './packages/client-browser/src/index.ts',
  target: 'web',
  stats: 'errors-only',
  node: {
    global: true,
    __filename: true,
    __dirname: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  output: {
    path: path.resolve(__dirname, './webpack'),
    filename: 'browser.js',
    libraryTarget: 'umd',
    globalObject: 'this',
    libraryExport: 'default',
    umdNamedDefine: true,
    library: 'clickhouse-js',
  },
  resolve: {
    extensions: [
      '.ts',
      '.js', // for 3rd party modules in node_modules
    ],
    plugins: [
      new TsconfigPathsPlugin({
        configFile: 'tsconfig.dev.json'
      }),
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': JSON.stringify({
        browser: true,
        CLICKHOUSE_TEST_CONNECTION_TYPE: 'browser'
      }),
    }),
  ],
}
