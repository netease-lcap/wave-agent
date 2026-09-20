import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The main process drives the agent over JSON-RPC (`wave --stdio`), so it only
 * needs the SDK's narrow entries (`/types`, `/constants`, `/stdio`) — never the
 * barrel. Importing the barrel for a single shared value drags the whole SDK
 * (tools, providers, transitive deps) into the main bundle, which is how a
 * module-evaluation-time throw in a dependency came to crash the app before
 * `whenReady` (`@vscode/ripgrep`, shipped in desktop 1.2.5). Shared values
 * intended for the hosts must live behind a narrow entry.
 */
const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("desktop main process SDK imports", () => {
  it("never imports the SDK barrel", () => {
    const offenders = tsFiles(SRC_DIR)
      .filter((file) =>
        /from\s+["']wave-agent-sdk["']/.test(readFileSync(file, "utf8")),
      )
      .map((file) => path.relative(SRC_DIR, file));

    expect(offenders).toEqual([]);
  });
});
