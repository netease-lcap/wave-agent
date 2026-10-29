// 打运维平台要的那份文档站压缩包（`docs-<version>.tar.gz`）。
//
// 这个包以前由 publish.yml 在发版时构建并挂到 GitHub Release 上；现在改成和远控
// Web 页（`pnpm -F wave-webview run pack:remote`）同一条路子：本地打包、手工上传
// （上传走 .wave/skills/ops-upload 技能，`upload.mjs --type docs`），CI 不再碰文档。
//
// 与 `pnpm run docs:build` 的差别只有两点，都是为了对齐平台侧的托管约定：
//   - 站点 base 换成 `/docs/`：文档在企业端挂在 `/docs/` 前缀下（GitHub Pages 用
//     config.js 里的 `/wave-agent/`，那是 pages.yml 的事，与这个包无关）。
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

function run(command, args, env = {}) {
  execFileSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

if (!reuseScreenshots) {
  run("pnpm", ["run", "docs:screenshots"]);
}

// base 必须在构建期定：VitePress 会把资源 URL 写死进 HTML 与 CSS。走 DOCS_BASE
// 而不是 CLI 的 `--base`，是因为后者只作用于资源前缀，config.js 里的 `base` 仍是
// `/wave-agent/`，而插件拼 llms.txt / llms-full.txt 的链接读的正是后者。
run("pnpm", ["exec", "vitepress", "build", "docs"], { DOCS_BASE: "/docs/" });

// dist 下全是待托管文件，`-C` 进去打 `.`，压缩包根目录即站点根目录。
//
// `--no-xattrs` 不是可选项：macOS 生成的文件带 `com.apple.provenance` 等扩展属性，
// bsdtar 会把它们写成每个成员一条 pax 扩展头（`SCHILY.xattr.*`）。这些头本身只有几十
// 字节，但平台侧的 tar 解包器会把它们实体化成 `._<原文件名>` 的 AppleDouble 文件，于是
// 一次 937 个文件的包在 file-center 落成近 1900 个对象（其中一半是 `._*` 垃圾）。GNU tar
// 也认这个开关，两个平台都能用。下面的自检就是防它回来。
run("tar", ["-czf", outFile, "--no-xattrs", "-C", distDir, "."]);

// 自检：压缩包里不得再有 xattr 扩展头（否则上传后又会出现 `._*` 对象）。
const rawArchive = execFileSync("gzip", ["-dc", outFile], {
  maxBuffer: 1 << 30,
}).toString("latin1");
const xattrHeaders = rawArchive.split("SCHILY.xattr").length - 1;
if (xattrHeaders > 0) {
  throw new Error(
    `压缩包内仍有 ${xattrHeaders} 条 SCHILY.xattr 扩展头，上传后会被解成 ._* 垃圾对象（检查 tar 是否漏了 --no-xattrs）`,
  );
}

console.log(`\n文档站压缩包：${outFile}`);
console.log(
  `上传：node .wave/skills/ops-upload/upload.mjs --file ${outFile} --type docs`,
);
