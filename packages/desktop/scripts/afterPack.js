#!/usr/bin/env node
/**
 * electron-builder afterPack hook — write the electron-updater config that
 * electron-builder skips (no publish config) and re-seal the macOS bundle for
 * ad-hoc (development) installs.
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
import { writeFileSync } from "node:fs";
import path from "node:path";

export default async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  // electron-builder only writes resources/app-update.yml when a publish
  // config is declared (or the repo resolves to GitHub). Without it
  // electron-updater's download step throws ENOENT and the app degrades to
  // the manual "download page" toast. The feed URL is injected at runtime
  // via setFeedURL, so this file only needs to exist; updaterCacheDirName
  // is what electron-updater reads from it.
  const resourcesDir =
    electronPlatformName === "darwin"
      ? path.join(
          appOutDir,
          `${packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : path.join(appOutDir, "resources");
  writeFileSync(
    path.join(resourcesDir, "app-update.yml"),
    "updaterCacheDirName: wave-desktop-updater\n",
  );

  if (electronPlatformName !== "darwin") return;
  const identity = context.packager.config?.mac?.identity;
  // Developer ID mode signs everything itself — an ad-hoc pass would be
  // redundant (and would be overwritten anyway).
  if (identity != null) return;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
}
