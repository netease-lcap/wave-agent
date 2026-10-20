import * as esbuild from "esbuild";
import path from "path";
import { createRequire } from "module";
import { copyFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * The wasm the extension loads at runtime: the tree-sitter runtime itself plus
 * every grammar `completionAst.ts` knows about. They are copied next
 * to `extension.cjs` because the packaged extension ships `dist/` only — a
 * `node_modules` path would not survive into the .vsix.
 */
const wasmFiles = [
  [
    path.join(
      path.dirname(require.resolve("web-tree-sitter")),
      "tree-sitter.wasm",
    ),
    "tree-sitter.wasm",
  ],
  // Must stay in sync with `LANGUAGES` in src/services/completionAst.ts.
  ...["typescript", "tsx", "javascript", "python", "java"].map((grammar) => [
    path.join(
      path.dirname(require.resolve("tree-sitter-wasms/package.json")),
      "out",
      `tree-sitter-${grammar}.wasm`,
    ),
    `tree-sitter-${grammar}.wasm`,
  ]),
];

/** @type {import("esbuild").Plugin} */
const copyWasmPlugin = {
  name: "copy-wasm",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      await mkdir("dist", { recursive: true });
      await Promise.all(
        wasmFiles.map(([from, to]) => copyFile(from, path.join("dist", to))),
      );
    });
  },
};

const backendConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: "warning",
  inject: [path.resolve(__dirname, "scripts/import-meta-url-shim.js")],
  define: { "import.meta.url": "import_meta_url" },
  plugins: [copyWasmPlugin],
};

async function main() {
  const ctx = await esbuild.context(backendConfig);
  if (watch) {
    console.log("[watch] backend build started");
    await ctx.watch();
  } else {
    console.log("[build] backend started");
    await ctx.rebuild();
    await ctx.dispose();
    console.log("[build] backend finished");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
