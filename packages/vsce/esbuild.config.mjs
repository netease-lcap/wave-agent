import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
// First non-flag argument is the target ('backend', 'frontend', or undefined for both)
const target = process.argv.slice(2).find(arg => !arg.startsWith('--'));

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

const frontendConfig = {
  entryPoints: ['webview/src/index.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: 'webview/dist/chat.js',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: 'warning',
  loader: {
    '.ttf': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
  },
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
};

async function build(config, name) {
  const ctx = await esbuild.context(config);
  if (watch) {
    console.log(`[watch] ${name} build started`);
    await ctx.watch();
  } else {
    console.log(`[build] ${name} started`);
    await ctx.rebuild();
    await ctx.dispose();
    console.log(`[build] ${name} finished`);
  }
}

async function main() {
  const configs = [];
  if (target === 'backend' || !target) {
    configs.push([backendConfig, 'backend']);
  }
  if (target === 'frontend' || !target) {
    configs.push([frontendConfig, 'frontend']);
  }

  if (watch) {
    await Promise.all(configs.map(([cfg, name]) => build(cfg, name)));
  } else {
    for (const [cfg, name] of configs) {
      await build(cfg, name);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
