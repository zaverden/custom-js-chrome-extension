process.env.NODE_ENV = 'production'
const webpack = require('webpack')
const config = require('../webpack.config')()
const TerserJSPlugin = require('terser-webpack-plugin')
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin')

delete config.chromeExtensionBoilerplate

webpack(
  {
    ...config,
    mode: 'production',
    optimization: {
      minimizer: [
        new TerserJSPlugin({
          test: /\.js(\?.*)?$/i,
          parallel: 2,
        }),
        new OptimizeCSSAssetsPlugin({}),
      ],
    },
  },
  function (err, stats) {
    if (err) throw err
    console.log(stats.toString({ colors: false, modules: false }))
    if (stats.hasErrors()) process.exitCode = 1
  },
)
