#!/usr/bin/env node
/**
 * electron-builder afterPack hook — re-seal the macOS bundle for ad-hoc
 * (development) installs.
 *
 * Two signing modes coexist:
 * - Developer ID (release): electron-builder signs every file individually
 *   with the configured identity; this hook does nothing.
 * - ad-hoc (desktop:install, `--config.mac.identity=null`): electron-builder
 *   skips signing entirely (`identity: null`), but its bundle mutation breaks
 *   the stock Electron ad-hoc seal ("code has no resources but signature
 *   indicates they must be present") and LaunchServices then silently refuses
 *   to open the app. Re-seal the whole bundle in a single `--deep` pass.
 *
 * `--deep` also seals the node-pty native binaries (pty.node + the
 * spawn-helper executable, asar-unpacked so posix_spawn/dlopen can reach
 * them) — both must carry a signature consistent with the bundle.
 */
import { execFileSync } from "node:child_process";

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const identity = context.packager.config?.mac?.identity;
  // Developer ID mode signs everything itself — an ad-hoc pass would be
  // redundant (and would be overwritten anyway).
  if (identity != null) return;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
}
