import { merge } from "webpack-merge";
import common from "./webpack.common.js";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import HtmlWebpackPlugin from "html-webpack-plugin";
import webpack from "webpack";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requestLogPath = path.resolve(__dirname, "requests.log");
fs.appendFileSync(requestLogPath, `\n--- dev server started ${new Date().toISOString()} ---\n`);

const certDir = path.resolve(os.homedir(), ".office-addin-dev-certs");

// Load .env so process.env.* is available inside the browser bundle.
const envFile = path.resolve(__dirname, ".env");
const envConfig = dotenv.config({ path: envFile }).parsed ?? {};

const dev = {
  mode: "development",
  devtool: "inline-source-map",
  devServer: {
    static: {
      directory: path.resolve(__dirname, "dist"),
    },
    // Word desktop hosts the taskpane in a cross-origin iframe and injects
    // Office.js from the host frame. Express defaults to
    // `Cross-Origin-Resource-Policy: same-origin`, which blocks the host
    // bridge (page renders but `Office` stays undefined). Override to
    // `cross-origin` so the Office.js bridge can attach.
    headers: {
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
    // Bind to `localhost` so the manifest's `https://localhost:3000` URL
    // matches the certificate CN. Binding to 127.0.0.1 while requesting
    // `localhost` triggers ERR_CERT_COMMON_NAME_INVALID in Edge WebView2.
    host: "localhost",
    port: 3000,
    server: {
      type: "https",
      options: {
        key: fs.readFileSync(path.resolve(certDir, "localhost.key")),
        cert: fs.readFileSync(path.resolve(certDir, "localhost.crt")),
      },
    },
    hot: true,
    open: false,
    historyApiFallback: true,
    // Log every HTTP request so we can see what Word's WebView2 actually
    // requests when it loads the taskpane. The Origin and User-Agent headers
    // are the key signals: a browser tab will show a different UA than
    // Word's embedded Edge WebView2, and the Origin header tells us whether
    // the request is same-origin (host bridge) or cross-origin.
    setupMiddlewares: (middlewares, devServer) => {
      const requestLogger = (req, res, next) => {
        const entry = [
          `[${new Date().toISOString()}]`,
          req.method,
          req.url,
          `origin=${req.headers.origin ?? "(none)"}`,
          `ua=${req.headers["user-agent"] ?? "(none)"}`,
          `referer=${req.headers.referer ?? "(none)"}`,
        ].join(" ");
        fs.appendFileSync(requestLogPath, entry + "\n");
        next();
      };
      devServer?.app?.use(requestLogger);
      return middlewares;
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/taskpane/taskpane.html",
      filename: "taskpane.html",
      chunks: ["runtime", "taskpane"],
      inject: "body",
    }),
    new HtmlWebpackPlugin({
      template: "./src/commands/commands.html",
      filename: "commands.html",
      chunks: ["runtime", "commands"],
      inject: "body",
    }),
    // Expose process.env to the browser bundle so core/config/env.ts can
    // read NODE_ENV, PORT, OPENAI_* and TELEMETRY_DISABLED at runtime.
    new webpack.DefinePlugin({
      "process.env": JSON.stringify(envConfig),
    }),
  ],
  optimization: {
    runtimeChunk: "single",
  },
};

export default merge(common, dev);
