const { merge } = require('webpack-merge')
const common = require('./webpack.common.js')
const webpack = require('webpack')
const path = require('path')
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin')
module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    static: './dist',
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': JSON.stringify({
        browser: true,
        CLICKHOUSE_TEST_ENVIRONMENT: process.env.CLICKHOUSE_TEST_ENVIRONMENT,
        CLICKHOUSE_CLOUD_HOST: process.env.CLICKHOUSE_CLOUD_HOST,
        CLICKHOUSE_CLOUD_PASSWORD: process.env.CLICKHOUSE_CLOUD_PASSWORD,
        CLICKHOUSE_JWT_ACCESS_TOKEN: process.env.CLICKHOUSE_JWT_ACCESS_TOKEN,
      }),
    }),
  ],
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
  output: {
    path: path.resolve(__dirname, './webpack'),
    // filename: 'browser.js',
    libraryTarget: 'umd',
    globalObject: 'this',
    libraryExport: 'default',
    umdNamedDefine: true,
    library: 'clickhouse-js',
  },
})
