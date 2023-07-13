const webpack = require('webpack')
const path = require('path')
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin')
module.exports = {
  // entry: './packages/client-browser/src/index.ts',
  target: 'web',
  stats: 'errors-only',
  devtool: 'eval-source-map',
  node: {
    global: true,
    __filename: true,
    __dirname: true,
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true
            }
          }
        ],
        exclude: [/node_modules/, /\*\*\/client-node/],
      },
    ],
  },
  output: {
    path: path.resolve(__dirname, './webpack'),
    // filename: 'browser.js',
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
        configFile: 'tsconfig.dev.json',
        logLevel: 'ERROR',
      }),
    ],
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': JSON.stringify({
        browser: true,
        CLICKHOUSE_TEST_ENVIRONMENT: process.env.CLICKHOUSE_TEST_ENVIRONMENT,
        CLICKHOUSE_CLOUD_HOST: process.env.CLICKHOUSE_CLOUD_HOST,
        CLICKHOUSE_CLOUD_PASSWORD: process.env.CLICKHOUSE_CLOUD_PASSWORD,
      }),
    }),
  ],
}
