import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The extension host drives the agent over JSON-RPC (the embedded `wave --stdio`
 * CLI), so it only needs the SDK's narrow entries (`/types`, `/constants`,
 * `/stdio`) — never the barrel. Importing the barrel for a single shared value
 * drags the whole SDK (tools, providers, transitive deps) into the extension
 * bundle, which is how a module-evaluation-time throw in a dependency came to
 * break extension activation (`@vscode/ripgrep`, shipped in 1.2.5). Shared
 * values intended for the hosts must live behind a narrow entry.
 */
const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("vscode extension host SDK imports", () => {
  it("never imports the SDK barrel", () => {
    const offenders = tsFiles(SRC_DIR)
      .filter((file) =>
        /from\s+["']wave-agent-sdk["']/.test(readFileSync(file, "utf8")),
      )
      .map((file) => path.relative(SRC_DIR, file));

    expect(offenders).toEqual([]);
  });
});
