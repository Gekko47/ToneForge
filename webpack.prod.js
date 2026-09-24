import { merge } from "webpack-merge";
import common from "./webpack.common.js";
import path from "path";
import { fileURLToPath } from "url";
import HtmlWebpackPlugin from "html-webpack-plugin";
import TerserPlugin from "terser-webpack-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prod = {
  mode: "production",
  devtool: "source-map",
  performance: {
    hints: "warning",
    maxAssetSize: 700 * 1024,
    maxEntrypointSize: 800 * 1024,
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].[contenthash].js",
    clean: true,
    publicPath: "./",
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/taskpane/taskpane.html",
      filename: "taskpane.html",
      chunks: ["runtime", "taskpane"],
      inject: "body",
      minify: {
        collapseWhitespace: true,
        removeComments: true,
      },
    }),
    new HtmlWebpackPlugin({
      template: "./src/commands/commands.html",
      filename: "commands.html",
      chunks: ["runtime", "commands"],
      inject: "body",
      minify: {
        collapseWhitespace: true,
        removeComments: true,
      },
    }),
  ],
  optimization: {
    runtimeChunk: "single",
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,
          },
        },
      }),
    ],
    splitChunks: {
      chunks: "all",
      maxInitialRequests: 12,
      cacheGroups: {
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          name: "vendors",
          chunks: "all",
          priority: -10,
          reuseExistingChunk: true,
        },
        common: {
          minChunks: 2,
          name: "common",
          priority: -20,
          reuseExistingChunk: true,
        },
      },
    },
  },
};

export default merge(common, prod);
