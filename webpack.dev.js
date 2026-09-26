import { merge } from "webpack-merge";
import common from "./webpack.common.js";
import { createLocalLlmBroker } from "./scripts/dev-broker.mjs";
import { createDevGatewayBroker } from "./scripts/dev-gateway.mjs";
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

// .env is loaded only into the development-server Node process. It is never
// serialized into browser assets; the broker below may use a server-only key.
const envFile = path.resolve(__dirname, ".env");
dotenv.config({ path: envFile });

const publicDevEnv = {
  NODE_ENV: "development",
  PORT: process.env.PORT ?? "3000",
  HTTPS_PORT: process.env.HTTPS_PORT ?? "3001",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  OPENAI_TIMEOUT_MS: process.env.OPENAI_TIMEOUT_MS ?? "30000",
  OPENAI_MAX_RETRIES: process.env.OPENAI_MAX_RETRIES ?? "2",
  TELEMETRY_DISABLED: process.env.TELEMETRY_DISABLED ?? "1",
  ANALYTICS_ENDPOINT: process.env.ANALYTICS_ENDPOINT ?? "",
};

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
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        const entry = [
          `[${new Date().toISOString()}]`,
          req.method,
          pathname,
          `origin=${req.headers.origin ?? "(none)"}`,
          `ua=${req.headers["user-agent"] ?? "(none)"}`,
          `referer=${req.headers.referer ? new URL(req.headers.referer, "http://localhost").pathname : "(none)"}`,
        ].join(" ");
        fs.appendFileSync(requestLogPath, entry + "\n");
        next();
      };
      const broker = createLocalLlmBroker();
      // Development-only OpenRouter stand-in. The production authentication and
      // broker service is a Phase 6 deliverable; this exists so the provider can
      // be exercised locally without a user key entering the browser bundle.
      const gateway = createDevGatewayBroker();
      devServer?.app?.use(requestLogger, broker, gateway);
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
    // Only explicitly allowlisted, non-secret client settings are compiled in.
    new webpack.DefinePlugin({
      "process.env": JSON.stringify(publicDevEnv),
    }),
  ],
  optimization: {
    runtimeChunk: "single",
  },
};

export default merge(common, dev);
