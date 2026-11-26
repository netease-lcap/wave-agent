import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "tests/__mocks__/vscode.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules"],
    // 通过的用例不打印 console 输出；失败的用例照打（vitest 会把它的日志重放出来）。
    silent: "passed-only",
    env: {
      // Keep the file logger out of the user's real ~/.wave/logs during tests.
      DISABLE_LOGGER_IO: "true",
    },
    server: {
      deps: {
        inline: ["wave-agent-sdk", "wave-webview-fixtures"],
      },
    },
  },
});
