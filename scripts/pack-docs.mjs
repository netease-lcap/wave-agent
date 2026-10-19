// 打运维平台要的那份文档站压缩包（`docs-<version>.tar.gz`）。
//
// 这个包以前由 publish.yml 在发版时构建并挂到 GitHub Release 上；现在改成和远控
// Web 页（`pnpm -F wave-webview run pack:remote`）同一条路子：本地打包、手工上传
// （上传走 .wave/skills/ops-upload 技能，`upload.mjs --type docs`），CI 不再碰文档。
//
// 与 `pnpm run docs:build` 的差别只有两点，都是为了对齐平台侧的托管约定：
//   - `--base /docs/`：文档在企业端挂在 `/docs/` 前缀下（GitHub Pages 用 config.js
//     里的 `/wave-agent/`，那是 pages.yml 的事，与这个包无关）。
//   - 出 tar.gz：压缩包根目录就是 `index.html`，解包后逐文件落成对象。
//
// 截图（docs/public/screenshots/，gitignored）是 docs 构建的硬依赖，所以先跑
// docs:screenshots（= webview demo 测试）。已经跑过、只想重新打包时可以加
// `--reuse-screenshots` 跳过这一步。
//
// Run: pnpm run docs:pack [-- --reuse-screenshots]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "docs/.vitepress/dist");
const reuseScreenshots = process.argv.includes("--reuse-screenshots");

const { version } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const outFile = join(root, `docs-${version}.tar.gz`);

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

if (!reuseScreenshots) {
  run("pnpm", ["run", "docs:screenshots"]);
}

// `--base` 必须在构建期定：VitePress 会把资源 URL 写死进 HTML 与 CSS。
run("pnpm", ["exec", "vitepress", "build", "docs", "--base", "/docs/"]);

// dist 下全是待托管文件，`-C` 进去打 `.`，压缩包根目录即站点根目录。
run("tar", ["-czf", outFile, "-C", distDir, "."]);

console.log(`\n文档站压缩包：${outFile}`);
console.log(
  `上传：node .wave/skills/ops-upload/upload.mjs --file ${outFile} --type docs`,
);
