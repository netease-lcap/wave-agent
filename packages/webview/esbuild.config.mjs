import * as esbuild from "esbuild";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const production = argv.includes("--production");
const watch = argv.includes("--watch");

/**
 * Two opt-in flags, both passed only by `remote/build.mjs` (the Web page build).
 * The default invocation — what every host artifact comes from
 * (`pnpm -F wave-webview build`) — passes neither and is byte-for-byte unchanged.
 *
 * `--outdir=<dir>`: write the bundles somewhere other than `dist/` (the remote
 * build sends them to a temp dir it then deletes), so building the page can
 * never overwrite the `dist/chat.js` the IDE and desktop hosts read.
 *
 * `--lazy-mermaid=<relative url>`: frontend bundle only — alias `mermaid` to the
 * loader in `src/mermaid-lazy.ts` and hand it the chunk URL, so the ~3.3 MB chart
 * library is fetched by the page on demand instead of riding in `chat.js` (78%
 * of that bundle; see the loader's header). Combining it with the default outdir
 * is refused: that would drop the page-shaped bundle where the hosts read theirs.
 */
const outDirArg = argv.find((a) => a.startsWith("--outdir="));
const lazyMermaidArg = argv.find((a) => a.startsWith("--lazy-mermaid="));
if (lazyMermaidArg && !outDirArg) {
  throw new Error(
    "--lazy-mermaid requires --outdir: the page bundle must not land in dist/, " +
      "which is what the IDE and desktop hosts load.",
  );
}
const OUT_DIR = outDirArg ? outDirArg.slice("--outdir=".length) : "dist";
const out = (name) => path.join(OUT_DIR, name);

const frontendConfig = {
  entryPoints: ["src/index.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: out("chat.js"),
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
    ...(lazyMermaidArg
      ? {
          __WAVE_MERMAID_CHUNK_URL__: JSON.stringify(
            lazyMermaidArg.slice("--lazy-mermaid=".length),
          ),
        }
      : {}),
  },
  ...(lazyMermaidArg
    ? {
        alias: {
          mermaid: fileURLToPath(
            new URL("./src/mermaid-lazy.ts", import.meta.url),
          ),
        },
      }
    : {}),
};

// Desktop-only terminal chunk (xterm.js). Exposes `window.WaveTerminal` and is
// lazy-injected by TerminalPane; VSCE/JetBrains sync targets filter it out so
// it never enters plugin artifacts.
const terminalConfig = {
  ...frontendConfig,
  entryPoints: ["src/terminal-entry.ts"],
  globalName: "WaveTerminal",
  outfile: out("terminal.js"),
};

// Desktop-only code editor chunk (CodeMirror 6). Exposes `window.WaveEditor`
// and is lazy-injected by the file panel's edit mode; VSCE/JetBrains sync
// targets filter it out so CodeMirror never enters plugin artifacts.
const editorConfig = {
  ...frontendConfig,
  entryPoints: ["src/editor-entry.ts"],
  globalName: "WaveEditor",
  outfile: out("editor.js"),
};

// VS Code plan-preview chunk (claudePlanPreview equivalent): a tiny standalone
// bundle loaded by the plan-preview WebviewPanel the extension opens beside the
// chat panel on ExitPlanMode. It has no global; the panel HTML links chat.css
// for markdown-body/theme styles, and the extension posts planContent into it.
const planPreviewConfig = {
  ...frontendConfig,
  entryPoints: ["src/plan-preview-entry.ts"],
  outfile: out("plan-preview.js"),
};

// Settings chunk: the shared SettingsPage rendered inside the editor-area
// settings tab that VSCE (createWebviewPanel) and JetBrains
// (WaveSettingsFileEditor) host open. esbuild emits a matching dist/settings.css
// (globals + codicons + SettingsPage.css) that the tab HTML links alongside it.
const settingsConfig = {
  ...frontendConfig,
  entryPoints: ["src/settings-preview-entry.tsx"],
  outfile: out("settings.js"),
};

async function main() {
  const ctx = await esbuild.context(frontendConfig);
  const terminalCtx = await esbuild.context(terminalConfig);
  const editorCtx = await esbuild.context(editorConfig);
  const planPreviewCtx = await esbuild.context(planPreviewConfig);
  const settingsCtx = await esbuild.context(settingsConfig);
  if (watch) {
    console.log("[watch] frontend build started");
    await ctx.watch();
    await terminalCtx.watch();
    await editorCtx.watch();
    await planPreviewCtx.watch();
    await settingsCtx.watch();
  } else {
    console.log("[build] frontend started");
    await ctx.rebuild();
    await ctx.dispose();
    await terminalCtx.rebuild();
    await terminalCtx.dispose();
    await editorCtx.rebuild();
    await editorCtx.dispose();
    await planPreviewCtx.rebuild();
    await planPreviewCtx.dispose();
    await settingsCtx.rebuild();
    await settingsCtx.dispose();
    console.log("[build] frontend finished");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
