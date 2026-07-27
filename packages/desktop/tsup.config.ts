import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'main/index': 'src/main/index.ts',
    'main/preload': 'src/main/preload.ts',
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: false,
  dts: false,
  external: ['electron'],
  // Bundle the SDK so the packaged app does not depend on node_modules layout.
  noExternal: ['wave-agent-sdk'],
  // Same import.meta shim as packages/vsce — agent-sdk's configPaths uses
  // import.meta.url which is empty in CJS output and would crash at init.
  inject: ['scripts/import-meta-url-shim.js'],
  define: { 'import.meta.url': 'import_meta_url' },
});
