#!/usr/bin/env node
// Launches a real VS Code instance (Extension Development Host) and runs the
// inline-completion e2e suite inside it.
//
//   pnpm -F wave-vscode run test:e2e:completion            # uses `dist/` as built
//   pnpm -F wave-vscode run test:e2e:completion -- --build # compiles first
//   pnpm -F wave-vscode run test:e2e:next-edit            # next-edit suite
//
// --next-edit runs the next-edit spec instead of the completion spec: the two
// need opposite project settings (next edit is off by default, and leaving it on
// during the completion suite would let it take over those assertions).
//
// Notes:
// - `--disable-extensions` keeps the user's installed extensions (and
//   GitHub.copilot-chat, which registers its own inline provider) out of the
//   run; the development extension from --extensionDevelopmentPath still loads.
// - A throwaway user-data-dir means no user settings leak in, and nothing we do
//   here mutates the user's real VS Code profile.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runTests } from "@vscode/test-electron";

const pkgRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = new Set(process.argv.slice(2));

const VSCODE_CANDIDATES = [
  process.env.WAVE_E2E_VSCODE,
  "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
  "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders",
  "/usr/share/code/code",
  "/usr/local/bin/code",
].filter(Boolean);

const executable = VSCODE_CANDIDATES.find((candidate) => existsSync(candidate));
if (!executable) {
  console.error(
    [
      "No local VS Code found. Set WAVE_E2E_VSCODE to the editor executable, e.g.",
      "  WAVE_E2E_VSCODE='/Applications/Visual Studio Code.app/Contents/MacOS/Code' \\",
      "    pnpm -F wave-vscode run test:e2e:completion",
    ].join("\n"),
  );
  process.exit(1);
}

if (args.has("--build")) {
  const build = spawnSync("pnpm", ["run", "compile"], {
    cwd: pkgRoot,
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

if (!existsSync(path.join(pkgRoot, "dist", "wave-cli"))) {
  console.error(
    "packages/vscode/dist/wave-cli is missing — run `pnpm -F wave-vscode run compile` (or pass --build).",
  );
  process.exit(1);
}

const profileDir = mkdtempSync(path.join(tmpdir(), "wave-vscode-e2e-profile-"));
const workspaceDir = mkdtempSync(path.join(tmpdir(), "wave-vscode-e2e-ws-"));
mkdirSync(workspaceDir, { recursive: true });
writeFileSync(path.join(workspaceDir, "README.md"), "# wave e2e workspace\n");

// Next edit ships switched off, so its suite switches it on for this throwaway
// workspace only — the project settings file the CLI already reads.
if (args.has("--next-edit")) {
  mkdirSync(path.join(workspaceDir, ".wave"), { recursive: true });
  writeFileSync(
    path.join(workspaceDir, ".wave", "settings.json"),
    `${JSON.stringify({ nextEditEnabled: true }, null, 2)}\n`,
  );
}

try {
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: pkgRoot,
    extensionTestsPath: path.join(pkgRoot, "tests-e2e", "index.cjs"),
    extensionTestsEnv: {
      WAVE_E2E_SPEC: args.has("--next-edit") ? "nextEdit" : "inlineCompletion",
    },
    launchArgs: [
      workspaceDir,
      "--new-window",
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      `--user-data-dir=${profileDir}`,
    ],
  });
} catch (error) {
  console.error("inline-completion e2e failed:", error);
  process.exit(1);
}
