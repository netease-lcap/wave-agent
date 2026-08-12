import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const frontendConfig = {
  entryPoints: ["src/index.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: "dist/chat.js",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: "warning",
  loader: {
    ".ttf": "dataurl",
    ".woff": "dataurl",
    ".woff2": "dataurl",
  },
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
  },
};

// Desktop-only terminal chunk (xterm.js). Exposes `window.WaveTerminal` and is
// lazy-injected by TerminalPane; VSCE/JetBrains sync targets filter it out so
// it never enters plugin artifacts.
const terminalConfig = {
  ...frontendConfig,
  entryPoints: ["src/terminal-entry.ts"],
  globalName: "WaveTerminal",
  outfile: "dist/terminal.js",
};

async function main() {
  const ctx = await esbuild.context(frontendConfig);
  const terminalCtx = await esbuild.context(terminalConfig);
  if (watch) {
    console.log("[watch] frontend build started");
    await ctx.watch();
    await terminalCtx.watch();
  } else {
    console.log("[build] frontend started");
    await ctx.rebuild();
    await ctx.dispose();
    await terminalCtx.rebuild();
    await terminalCtx.dispose();
    console.log("[build] frontend finished");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
