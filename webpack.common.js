import path from "path";
import { fileURLToPath } from "url";
import Configuration from "webpack";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const common = {
  mode: "development",
  entry: {
    /*
     * `semantic` is a SECOND PAGE of the one task pane, not a second pane.
     *
     * The context menu is a task pane command (ADR-0107) so it runs no JavaScript
     * of ours and cannot ask an open pane to navigate; Microsoft documents that a
     * command sharing a `TaskpaneId` has its pane contents replaced with its own
     * `SourceLocation` (ADR-0109). This entry is that page, and it exists because
     * a page is the only instruction such a command can carry.
     */
    taskpane: "./src/taskpane/index.tsx",
    semantic: "./src/taskpane/semantic.tsx",
    commands: "./src/commands/commands.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    clean: true,
    publicPath: "/",
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "ts-loader",
            options: {
              configFile: path.resolve(__dirname, "tsconfig.build.json"),
              transpileOnly: true,
            },
          },
        ],
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg)$/,
        type: "asset/resource",
      },
    ],
  },
  plugins: [new Configuration.HotModuleReplacementPlugin()],
};

export default common;
