/**
 * Keep yargs' `hideBin()` slicing argv the way a plain `node script.js` run
 * does, even when the CLI is executed by the Electron runtime.
 *
 * Electron RUN_AS_NODE (the desktop / vscode bundled runtime, `process.execPath`
 * + `ELECTRON_RUN_AS_NODE=1`) leaves `process.versions.electron` set, so
 * `hideBin()` mistakes the process for a *packaged* Electron app, slices argv
 * from index 0 instead of 1, and keeps the script path as a positional
 * argument — yargs then prints its help and exits 1 with
 * `Unknown argument: <script>`, i.e. the host sees a CLI that dies on launch.
 * `process.defaultApp` is exactly the signal `hideBin()` reads as "plain node".
 *
 * `bin/wave-code.js` carries the same guard for the shim entry; this module
 * covers the bundle entry (`dist/bundle/wave.mjs`), which a host runs directly
 * whenever `WAVE_CLI_PATH` points at the workspace build — the documented dev
 * setup — instead of the shim.
 */
export function ensurePlainNodeArgv(): void {
  if (process.versions.electron && process.env.ELECTRON_RUN_AS_NODE === "1") {
    // `defaultApp` is an Electron-only property, absent from @types/node.
    (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp = true;
  }
}
