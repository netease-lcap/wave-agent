import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const frontendConfig = {
  entryPoints: ['src/index.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: 'dist/chat.js',
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

async function main() {
  const ctx = await esbuild.context(frontendConfig);
  if (watch) {
    console.log('[watch] frontend build started');
    await ctx.watch();
  } else {
    console.log('[build] frontend started');
    await ctx.rebuild();
    await ctx.dispose();
    console.log('[build] frontend finished');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
