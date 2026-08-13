#!/usr/bin/env node
/**
 * Cross-platform "install/update the installed Wave desktop app".
 *
 * - macOS: package the app dir and rsync it over /Applications/Wave.app
 *   (safe to do while the app is running).
 * - Windows: package win-unpacked and copy it over the detected install
 *   directory (%LOCALAPPDATA%\Programs\Wave — the NSIS default — falling
 *   back to the registry InstallLocation, or WAVE_INSTALL_DIR). Windows
 *   locks a running exe, so quit Wave first if the copy fails.
 *
 * A full `pnpm build` runs first (required: the user consumes wave-code
 * via npm link).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(desktopDir, "../..");

function runPnpm(args, cwd) {
  // On Windows, pnpm is pnpm.cmd; spawn it via the shell as a string command
  // (array + shell:true would trigger the DEP0190 warning).
  const r = isWin
    ? spawnSync(`pnpm.cmd ${args.join(" ")}`, { stdio: "inherit", shell: true, cwd })
    : spawnSync("pnpm", args, { stdio: "inherit", cwd });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** reg.exe emits OEM code page (GBK on zh-CN) — decode like the bash tool does. */
function decodeRegOutput(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("gbk").decode(buf);
  }
}

function queryRegistryInstallLocation() {
  // electron-builder NSIS writes the uninstaller key by productName ("Wave").
  for (const hive of ["HKCU", "HKLM"]) {
    const key = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Wave`;
    const r = spawnSync("reg", ["query", key, "/v", "InstallLocation"], {
      encoding: "buffer",
    });
    if (r.status === 0) {
      const m = decodeRegOutput(r.stdout).match(
        /InstallLocation\s+REG_SZ\s+(.+)/i,
      );
      if (m && m[1].trim()) return m[1].trim();
    }
  }
  return null;
}

function findInstallDir() {
  if (process.env.WAVE_INSTALL_DIR) return process.env.WAVE_INSTALL_DIR;
  const def = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "Programs",
    "Wave",
  );
  if (fs.existsSync(def)) return def;
  const fromRegistry = queryRegistryInstallLocation();
  if (fromRegistry) return fromRegistry;
  console.error(
    "Could not locate an existing Wave installation. Install once with the NSIS installer (`pnpm run dist`), or set WAVE_INSTALL_DIR to the install folder.",
  );
  process.exit(1);
}

// 1. Full build
console.log("[desktop:install] Building all packages…");
runPnpm(["build"], repoDir);

// 2. Package the app dir. macOS needs identity=null for ad-hoc installs;
// Windows skips the native-module rebuild (node-pty ships N-API prebuilds that
// Electron loads directly — avoids a node-gyp/Python toolchain requirement).
console.log("[desktop:install] Packaging app dir…");
if (isMac) {
  runPnpm(
    ["-F", "wave-desktop", "exec", "electron-builder", "--dir", "--config.mac.identity=null"],
    repoDir,
  );
} else {
  runPnpm(
    ["-F", "wave-desktop", "exec", "electron-builder", "--dir", "--config.npmRebuild=false"],
    repoDir,
  );
}

// 3. Copy over the installed app
if (isMac) {
  const src = path.join(desktopDir, "release", "mac-arm64", "Wave.app");
  const dest = "/Applications/Wave.app";
  console.log(`[desktop:install] Syncing ${src} → ${dest}`);
  const r = spawnSync("rsync", ["-a", "--delete", `${src}/`, `${dest}/`], {
    stdio: "inherit",
    cwd: repoDir,
  });
  process.exit(r.status ?? 0);
}

if (isWin) {
  const src = path.join(desktopDir, "release", "win-unpacked");
  const dest = findInstallDir();
  console.log(`[desktop:install] Copying ${src} → ${dest}`);
  if (!fs.existsSync(src)) {
    console.error(`Expected app dir not found: ${src}`);
    process.exit(1);
  }
  // Remove stale files first (mirror of rsync --delete). Windows locks a
  // running exe, so a locked Wave.exe fails here — tell the user to quit.
  try {
    fs.rmSync(dest, { recursive: true, force: true });
  } catch (err) {
    console.error(
      `Failed to clear ${dest}: ${err.message}\n` +
        "Wave is probably still running — quit it and re-run `pnpm run desktop:install`.",
    );
    process.exit(1);
  }
  fs.cpSync(src, dest, { recursive: true, force: true });
  console.log("[desktop:install] Done.");
  process.exit(0);
}

console.error(`Unsupported platform: ${process.platform}`);
process.exit(1);
