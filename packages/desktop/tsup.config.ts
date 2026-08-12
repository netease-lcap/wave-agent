import { defineConfig } from "tsup";

const shared = {
  format: ["cjs"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  sourcemap: true,
  clean: false,
  dts: false,
  external: ["electron"],
} as const;

export default defineConfig([
  {
    ...shared,
    entry: {
      "main/index": "src/main/index.ts",
      "main/preload": "src/main/preload.ts",
    },
    // Bundle the SDK so the packaged app does not depend on node_modules layout.
    noExternal: ["wave-agent-sdk"],
    // Same import.meta shim as packages/vscode — agent-sdk's configPaths uses
    // import.meta.url which is empty in CJS output and would crash at init.
    inject: ["scripts/import-meta-url-shim.js"],
    define: { "import.meta.url": "import_meta_url" },
  },
  {
    ...shared,
    entry: { "main/pickerPreload": "src/main/pickerPreload.ts" },
    // Runs inside a sandboxed <webview> guest where only the Electron preload
    // require polyfill exists — the import.meta shim's require('url') would
    // break there, and agent-sdk is not imported anyway.
  },
]);
