import { defineConfig } from "vitest/config";
import path from "path";
import os from "os";

/**
 * Real-host integration config (Part B).
 *
 * Unlike `vitest.config.ts` (which mocks fs + StdioClient + the SDK), these
 * tests boot the *real* DesktopHost against the *real* `wave --stdio` CLI
 * child process: real JSON-RPC over stdin/stdout, real session transcripts on
 * disk. Only the Electron shell is stubbed (there is no display in CI) — see
 * `tests/__mocks__/electron.ts`.
 *
 * Everything runs against a throwaway HOME so the CLI never touches the
 * developer's ~/.wave state.
 */

const REALHOST_ROOT = path.join(os.tmpdir(), "wave-desktop-realhost");
const REALHOST_HOME = path.join(REALHOST_ROOT, "home");

export default defineConfig({
  resolve: {
    alias: {
      electron: path.resolve(__dirname, "tests/__mocks__/electron.ts"),
    },
  },
  test: {
    globals: true,
    reporter: "dot",
    environment: "node",
    include: ["tests/integration/**/*.integration.test.ts"],
    exclude: ["node_modules"],
    // Each suite spawns a real CLI subprocess and runs a real Agent.create.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One child process pool at a time keeps port/socket and HOME contention out.
    fileParallelism: false,
    // No `dangerouslyIgnoreUnhandledErrors`: a host-side promise that forgets a
    // catch must make this suite red (the unit layer can never see it — every
    // RPC is mocked there). The harness additionally registers its own
    // `unhandledRejection` listener so the leak is attributed to a test
    // (`assertNoUnexpectedRejections`) instead of only failing the file.
    env: {
      HOME: REALHOST_HOME,
      USERPROFILE: REALHOST_HOME,
      WAVE_LOGS_DIR: path.join(REALHOST_HOME, ".wave", "logs"),
      DISABLE_LOGGER_IO: "true",
      // Short-circuits binaryResolver: no CLI copy into ~/.wave/cli, no
      // ripgrep download — the workspace CLI is used directly.
      WAVE_CLI_PATH: path.resolve(__dirname, "../code/bin/wave-code.js"),
    },
    server: {
      deps: {
        inline: ["wave-agent-sdk", "wave-webview-fixtures"],
      },
    },
  },
});
