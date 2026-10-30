import { describe, it, expect, afterEach } from "vitest";
import { ensurePlainNodeArgv } from "../../src/utils/argvCompat.js";

/** process.versions.electron is read-only on a real Node — redefine it. */
function setElectronVersion(value: string | undefined): void {
  Object.defineProperty(process.versions, "electron", {
    value,
    configurable: true,
    writable: true,
  });
}

const originalElectron = process.versions.electron;
const originalRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
const originalDefaultApp = (
  process as NodeJS.Process & { defaultApp?: boolean }
).defaultApp;

describe("ensurePlainNodeArgv", () => {
  afterEach(() => {
    setElectronVersion(originalElectron);
    if (originalRunAsNode === undefined) {
      delete process.env.ELECTRON_RUN_AS_NODE;
    } else {
      process.env.ELECTRON_RUN_AS_NODE = originalRunAsNode;
    }
    (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp =
      originalDefaultApp;
  });

  it("marks the process as the default Electron app under RUN_AS_NODE", () => {
    // The exact environment the desktop app spawns the CLI with: yargs'
    // hideBin() would otherwise keep the script path in argv and the CLI would
    // exit 1 with `Unknown argument: <script>`.
    setElectronVersion("37.0.0");
    process.env.ELECTRON_RUN_AS_NODE = "1";

    ensurePlainNodeArgv();

    expect(
      (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp,
    ).toBe(true);
  });

  it("leaves a plain Node process alone", () => {
    setElectronVersion(undefined);
    process.env.ELECTRON_RUN_AS_NODE = "1";

    ensurePlainNodeArgv();

    expect(
      (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp,
    ).toBeUndefined();
  });

  it("leaves a real Electron app (no RUN_AS_NODE) alone", () => {
    setElectronVersion("37.0.0");
    delete process.env.ELECTRON_RUN_AS_NODE;

    ensurePlainNodeArgv();

    expect(
      (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp,
    ).toBeUndefined();
  });
});
