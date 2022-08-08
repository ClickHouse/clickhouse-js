const webpack = require('webpack');
const path = require('path');

module.exports = {
  entry: './src/index.ts',
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
    path: path.resolve(__dirname, './dist'),
    filename: 'browser.js',
    libraryTarget: 'umd',
    globalObject: 'this',
    libraryExport: 'default',
    umdNamedDefine: true,
    library: 'Clickhouse',
  },
  resolve: {
    extensions: [
      '.ts',
      '.js' // for 3rd party modules in node_modules
    ],
    fallback: {
      assert: require.resolve('assert'),
      buffer: require.resolve('buffer'),
      stream: require.resolve('stream-browserify'),
      http: require.resolve('stream-http'),
      url: require.resolve('url'),
      querystring: require.resolve('querystring-es3'),
      util: false,
      process: require.resolve('process/browser'),
      zlib: require.resolve('browserify-zlib'),
    }
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': JSON.stringify({
        browser: true
      })
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser',
    }),
  ]
}
