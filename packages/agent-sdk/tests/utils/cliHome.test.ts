import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { cliHomeDir, resolveFromAnchors } from "../../src/utils/cliHome.js";

describe("cliHomeDir", () => {
  it("is the shared directory the hosts copy the CLI into", () => {
    // Fixed by the hosts and by `runtimeDeps`; the spec pins it as
    // `~/.wave/cli/node_modules` (`ui/stdio-transport.md` 场景 5).
    expect(cliHomeDir()).toBe(path.join(os.homedir(), ".wave", "cli"));
  });
});

describe("resolveFromAnchors", () => {
  it("stops at the first anchor that answers", () => {
    const seen: NodeRequire[] = [];
    const found = resolveFromAnchors((requireFn) => {
      seen.push(requireFn);
      return seen.length === 2 ? "second-anchor" : undefined;
    });

    expect(found).toBe("second-anchor");
    expect(seen).toHaveLength(2);
  });

  it("asks every anchor before reporting nothing found", () => {
    // An install that can see the package from neither its own position nor the
    // download directory is the only case that may report a missing binary.
    let probes = 0;
    expect(
      resolveFromAnchors(() => {
        probes += 1;
        return undefined;
      }),
    ).toBeUndefined();
    expect(probes).toBe(2);
  });
});
