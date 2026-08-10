import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const backendConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: 'warning',
  inject: [path.resolve(__dirname, 'scripts/import-meta-url-shim.js')],
  define: { 'import.meta.url': 'import_meta_url' },
};

async function main() {
  const ctx = await esbuild.context(backendConfig);
  if (watch) {
    console.log('[watch] backend build started');
    await ctx.watch();
  } else {
    console.log('[build] backend started');
    await ctx.rebuild();
    await ctx.dispose();
    console.log('[build] backend finished');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
