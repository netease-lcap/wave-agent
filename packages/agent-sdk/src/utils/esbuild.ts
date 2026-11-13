import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveFromAnchors } from "./cliHome.js";
import { isPackageOnDisk } from "./packageOnDisk.js";

/**
 * Lazy access to the optional `esbuild` transpiler.
 *
 * ## Why a runtime require
 *
 * esbuild's JS API refuses to run from inside a bundle — `esbuild/lib/main.js`
 * throws `The esbuild JavaScript API cannot be bundled` the first time it is
 * asked for its binary, because it locates that binary with
 * `require.resolve("@esbuild/<platform>-<arch>/bin/esbuild")` relative to its
 * own file. A bundled copy sits in `dist/bundle/wave.mjs`, so the relative walk
 * points nowhere. Resolution therefore goes through `createRequire` against the
 * two anchors in `cliHome.ts`: the module's own position (an npm install puts
 * the package on that chain) and `~/.wave/cli/node_modules` (where
 * `utils/runtimeDeps.ts` unpacks the download). Same mechanism as `ripgrep.ts`.
 *
 * It is *not* resolved at module-evaluation time: the installer downloads the
 * package after the module graph has been evaluated, and a frozen "missing"
 * would keep every TSX mod failing for the rest of the process. The installer
 * calls {@link resetEsbuild} once the package is on disk.
 *
 * ## Why the platform package is probed separately, and from esbuild's own dir
 *
 * `require("esbuild")` succeeds even when `@esbuild/<platform>-<arch>` is
 * absent — the lookup happens lazily on the first `transform()`/`build()`, and
 * then fails with "You installed esbuild for another platform". Reporting the
 * transpiler as available in that state would surface as a confusing failure at
 * mod-compile time instead of the honest "TSX mod 需要 esbuild" summary.
 *
 * The probe cannot run from the same anchor as `esbuild` itself: pnpm's strict
 * layout installs the platform package under
 * `.pnpm/esbuild@<v>/node_modules/@esbuild/<key>`, where it is a *sibling of
 * esbuild*, invisible from the SDK's own `node_modules`. Probing from the
 * caller's anchor therefore reported a healthy install as broken. `esbuild`
 * resolves it with a `require.resolve` relative to itself, so the check goes
 * through a require rooted at the resolved esbuild package — the same place, so
 * the two agree by construction.
 */
export type EsbuildApi = typeof import("esbuild");

/** The platform package esbuild looks for on this machine. */
export const ESBUILD_PLATFORM_PACKAGE = `@esbuild/${process.platform}-${process.arch}`;

let cached: EsbuildApi | undefined;
let resolutionAttempted = false;

/** Whether the platform binary package sits next to the resolved esbuild. */
function hasPlatformPackage(esbuildEntry: string): boolean {
  // `<pkg>/lib/main.js` → `<pkg>`.
  const packageDir = path.dirname(path.dirname(esbuildEntry));
  const requireFn = createRequire(path.join(packageDir, "package.json"));
  const dirs = requireFn.resolve?.paths?.(ESBUILD_PLATFORM_PACKAGE);
  if (!dirs) return false;
  return dirs.some((dir) =>
    fs.existsSync(path.join(dir, ESBUILD_PLATFORM_PACKAGE)),
  );
}

/**
 * Load esbuild through [requireFn], or `undefined` when it (or its platform
 * binary) is not installed. [requireFn] is injectable so the installer can
 * verify an install from the directory the CLI will actually load it from, and
 * so tests can exercise both outcomes without the real package.
 */
export function resolveEsbuild(requireFn: NodeRequire): EsbuildApi | undefined {
  if (!isPackageOnDisk(requireFn, "esbuild")) return undefined;
  try {
    const entry = requireFn.resolve("esbuild");
    if (!hasPlatformPackage(entry)) return undefined;
    return requireFn("esbuild") as EsbuildApi;
  } catch {
    return undefined;
  }
}

/**
 * The esbuild API, or `undefined` when TSX mods cannot be compiled. Memoised
 * once resolved.
 */
export function getEsbuild(): EsbuildApi | undefined {
  if (!resolutionAttempted) {
    resolutionAttempted = true;
    cached = resolveFromAnchors(resolveEsbuild);
  }
  return cached;
}

/**
 * Forget the memoised API so the next {@link getEsbuild} resolves again. Called
 * by the runtime-dependency installer once esbuild is on disk — without it a
 * process that asked for it *before* the download finished would report TSX
 * mods as unsupported for its whole lifetime. Also used by tests.
 */
export function resetEsbuild(): void {
  cached = undefined;
  resolutionAttempted = false;
}
