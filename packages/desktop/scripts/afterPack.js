#!/usr/bin/env node
/**
 * electron-builder afterPack hook — ad-hoc re-sign the macOS bundle.
 *
 * electron-builder mutates the stock Electron bundle (renames it, drops in
 * app.asar, edits Info.plist) which breaks the linker-ad-hoc resource seal
 * ("code has no resources but signature indicates they must be present").
 * LaunchServices then silently refuses to open the app (direct exec of the
 * binary still works, which masks the bug). First release ships unsigned
 * (FR-021), so re-seal with an ad-hoc signature; without this hook
 * electron-builder skips signing entirely when `identity: null`.
 */
import { execFileSync } from 'node:child_process';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
}
