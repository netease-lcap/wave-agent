// Bundle the CLI into a single ESM file so startup skips Node's per-import
// node_modules resolution (measured: ~5s module load -> ~0.6s).
//
// Notes:
// - createRequire banner: some bundled CJS deps call require() at runtime.
// - @vscode/ripgrep / fsevents must stay external: they resolve platform
//   binaries (or optional native builds) at import time.
// - "@" path alias must mirror tsconfig paths for the bundled entry.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "dist", "bundle", "wave.mjs");

// ink only dynamic-imports its devtools.js when DEV=true; the module itself
// has a top-level `import "react-devtools-core"` (not installed), so stub it
// out — the devtools path can never be used in production. onLoad matches the
// resolved absolute path (onResolve would match only the relative import
// text like "./devtools.js", which never matches this filter).
const inkDevtoolsStub = {
  name: "ink-devtools-stub",
  setup(build) {
    build.onLoad(
      { filter: /[\\/]ink[\\/]build[\\/]devtools\.js$/ },
      () => ({ contents: "export default undefined;", loader: "js" }),
    );
  },
};

const start = Date.now();
await build({
  entryPoints: [path.join(root, "src", "index.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  banner: {
    js: 'import { createRequire } from "module";\nconst require = createRequire(import.meta.url);',
  },
  external: ["@vscode/ripgrep", "fsevents"],
  alias: { "@": path.join(root, "src") },
  plugins: [inkDevtoolsStub],
  // Shrinks the bundle ~2.2x (8.4MB -> 3.7MB raw) and drops React's
  // development-mode builds, which cuts Node parse/compile time at startup.
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

const size = fs.statSync(outfile).size;
console.log(
  `bundled wave-code in ${Date.now() - start} ms -> ${path.relative(root, outfile)} (${(size / 1024 / 1024).toFixed(1)} MB)`,
);
