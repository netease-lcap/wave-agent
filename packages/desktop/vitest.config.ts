import { defineConfig } from "vitest/config";
import path from "path";
import { longFormTempDir } from "./tests/helpers/tempDir";

/**
 * One entry point, two test layers.
 *
 * - `unit`     — mocks fs + StdioClient + the SDK (everything under `tests/`,
 *                minus `tests/integration/**`).
 * - `realhost` — boots the *real* DesktopHost against the *real*
 *                `wave --stdio` child process: real JSON-RPC over
 *                stdin/stdout, real session transcripts on disk. Only the
 *                Electron shell is stubbed (there is no display in CI) — see
 *                `tests/__mocks__/electron.ts`.
 *
 * Both are vitest projects rather than two config files, so a single
 * `vitest run` (`pnpm -F wave-desktop test`) covers all of them
 * while every option that differs between the layers — `env`, `include`,
 * `testTimeout`/`hookTimeout`, `fileParallelism` — stays per-project. Projects
 * run one after another, so the real-host layer still gets the machine to
 * itself.
 *
 * `pnpm -F wave-desktop run test:realhost` still runs the real-host layer
 * alone (`--project realhost`).
 */

/**
 * Real-host scratch root.
 *
 * Everything runs against a throwaway HOME so the CLI never touches the
 * developer's ~/.wave state.
 *
 * The scratch root is namespaced by the runner's pid: `resetRealHostState()`
 * wipes the whole tree in every `beforeEach`, so two runs sharing one machine
 * (e.g. separate git worktrees) must not share a root or they delete each
 * other's HOME mid-test.
 */
const REALHOST_ROOT = path.join(
  longFormTempDir(),
  `wave-desktop-realhost-${process.pid}`,
);
const REALHOST_HOME = path.join(REALHOST_ROOT, "home");

const shared = {
  resolve: {
    alias: {
      electron: path.resolve(__dirname, "tests/__mocks__/electron.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    server: {
      deps: {
        inline: ["wave-agent-sdk", "wave-webview-fixtures"],
      },
    },
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        ...shared,
        test: {
          ...shared.test,
          name: "unit",
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
          // No real CLI, no real HOME: the real-host layer is the `realhost`
          // project below, and must stay out of this one.
          exclude: ["node_modules", "tests/integration/**"],
          env: {
            // Keep the file logger out of the user's real ~/.wave/logs during tests.
            DISABLE_LOGGER_IO: "true",
          },
        },
      },
      {
        ...shared,
        test: {
          ...shared.test,
          name: "realhost",
          include: ["tests/integration/**/*.integration.test.ts"],
          exclude: ["node_modules"],
          // Each suite spawns a real CLI subprocess and runs a real Agent.create.
          testTimeout: 120_000,
          hookTimeout: 120_000,
          // One child process pool at a time keeps port/socket and HOME contention out.
          fileParallelism: false,
          // No `dangerouslyIgnoreUnhandledErrors`: a host-side promise that
          // forgets a catch must make this suite red (the unit layer can never
          // see it — every RPC is mocked there). The harness additionally
          // registers its own `unhandledRejection` listener so the leak is
          // attributed to a test (`assertNoUnexpectedRejections`) instead of
          // only failing the file.
          env: {
            // Hands the pid-namespaced root to the harness, which derives
            // STORE_PATH/DIR_A/DIR_B from it (the worker has a different pid).
            WAVE_REALHOST_ROOT: REALHOST_ROOT,
            HOME: REALHOST_HOME,
            USERPROFILE: REALHOST_HOME,
            WAVE_LOGS_DIR: path.join(REALHOST_HOME, ".wave", "logs"),
            DISABLE_LOGGER_IO: "true",
            // Short-circuits binaryResolver: no CLI copy into ~/.wave/cli, no
            // ripgrep download — the workspace CLI is used directly.
            WAVE_CLI_PATH: path.resolve(__dirname, "../code/bin/wave-code.js"),
          },
        },
      },
    ],
  },
});
