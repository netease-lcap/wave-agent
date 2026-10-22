#!/usr/bin/env node
// Launches a real VS Code instance (Extension Development Host) and runs the
// IDE-context e2e suite (`@terminal` / `@problems`) inside it.
//
//   pnpm -F wave-vscode run test:e2e:ide-context            # uses the source service
//   pnpm -F wave-vscode run test:e2e:ide-context -- --build # recompiles the extension first
//
// Why this suite needs its own runner: the suite asserts on the host's IDE reads
// (`src/services/ideContextService.ts`), which is a plain class over `vscode`
// APIs — it is bundled here with esbuild and required by the spec, so the test
// happens *inside* the extension host against a real terminal and a real
// diagnostics producer. No agent session and no model call is involved, so this
// one runs without burning quota.
//
// Same launch hygiene as the completion suite: throwaway `--user-data-dir`, a
// temp workspace, and `--disable-extensions` (the built-in TypeScript extension
// still loads, which is what produces the diagnostics under test).
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";

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
      "  WAVE_E2E_VSCODE='/usr/share/code/code' \\",
      "    pnpm -F wave-vscode run test:e2e:ide-context",
    ].join("\n"),
  );
  process.exit(1);
}

if (args.has("--build")) {
  const build1 = spawnSync("pnpm", ["run", "compile"], {
    cwd: pkgRoot,
    stdio: "inherit",
  });
  if (build1.status !== 0) process.exit(build1.status ?? 1);
}

if (!existsSync(path.join(pkgRoot, "dist", "extension.cjs"))) {
  console.error(
    "packages/vscode/dist/extension.cjs is missing — run `pnpm -F wave-vscode run compile` (or pass --build).",
  );
  process.exit(1);
}

const workDir = mkdtempSync(path.join(tmpdir(), "wave-vscode-ide-context-"));
const profileDir = path.join(workDir, "profile");
const workspaceDir = path.join(workDir, "workspace");
mkdirSync(profileDir, { recursive: true });
// A real TypeScript syntax error: the built-in TypeScript extension reports it
// without any tsconfig, so the diagnostics under test are produced by the real
// language service rather than by this script.
mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
writeFileSync(
  path.join(workspaceDir, "src", "broken.ts"),
  "export const broken: = 1;\n",
);

// Bundle the service under test (it imports `vscode`, which only exists inside
// the extension host) so the spec can `require` it there.
const bundlePath = path.join(workDir, "ideContextService.cjs");
await build({
  entryPoints: [path.join(pkgRoot, "src", "services", "ideContextService.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  logLevel: "warning",
});

try {
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: pkgRoot,
    extensionTestsPath: path.join(pkgRoot, "tests-e2e", "ideContext.cjs"),
    extensionTestsEnv: { WAVE_E2E_IDE_CONTEXT_BUNDLE: bundlePath },
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
  console.error("ide-context e2e failed:", error);
  process.exit(1);
}
