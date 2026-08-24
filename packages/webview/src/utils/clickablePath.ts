/**
 * 行内代码中的文件路径判定与行号拆分（spec: docs/specs/ui/markdown-links.md）。
 *
 * 与行内代码 URL 提升同机制：仅处理反引号包裹的文本。判定为启发式白名单
 * （借鉴 opencode 的 inlineCodeKind，缩减扩展名表），不做文件存在性预检查——
 * 文件是否存在由宿主在打开时处理。输入可为 marked 转义后的文本（renderer
 * 场景）或 DOM textContent（点击场景），判定前统一反转义。
 */

// 常见源码/配置/文档/数据/脚本扩展名（opencode 全量 Linguist 表的常用子集）。
// 数字后缀（如 `1.2`）不在表中，天然排除版本号误判。
const pathExtensions = new Set([
  // web / 前端
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
  "vue",
  "svelte",
  "astro",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "styl",
  // 配置 / 数据
  "json",
  "jsonc",
  "json5",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "config",
  "xml",
  "env",
  "properties",
  "plist",
  // 文档
  "md",
  "mdx",
  "markdown",
  "txt",
  "rst",
  "adoc",
  // 后端
  "py",
  "pyi",
  "java",
  "kt",
  "kts",
  "go",
  "rs",
  "rb",
  "php",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "hh",
  "cs",
  "fs",
  "fsx",
  "swift",
  "scala",
  "clj",
  "cljs",
  "ex",
  "exs",
  "erl",
  "hs",
  "lua",
  "r",
  "dart",
  "zig",
  // 脚本
  "sh",
  "bash",
  "zsh",
  "fish",
  "bat",
  "cmd",
  "ps1",
  // 数据 / 查询
  "sql",
  "graphql",
  "gql",
  "proto",
  "csv",
  "tsv",
  "log",
  // 构建 / 工具
  "gradle",
  "groovy",
  "tf",
  "hcl",
  "lock",
  "patch",
  "diff",
  "sum",
  "map",
]);

// 常见点文件与无已知扩展名的知名文件名（如 Makefile、Dockerfile、.gitignore）。
const knownFileNames = new Set([
  // 点文件
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".dockerignore",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
  ".yarnrc",
  ".babelrc",
  ".eslintrc",
  ".eslintignore",
  ".prettierrc",
  ".prettierignore",
  ".stylelintrc",
  ".flake8",
  ".pylintrc",
  ".env",
  ".env.example",
  // 知名文件名
  "makefile",
  "dockerfile",
  "gemfile",
  "rakefile",
  "procfile",
  "vagrantfile",
  "jenkinsfile",
  "justfile",
  "brewfile",
  "podfile",
  "caskfile",
  "build",
  "workspace",
  "gradlew",
  "mvnw",
  "web.config",
]);

// 知名文件名的带后缀变体（Dockerfile.dev、Makefile.am 等）。
const knownFileNamePrefixes = [
  ".env.",
  "dockerfile.",
  "makefile.",
  "gemfile.",
  "rakefile.",
  "procfile.",
  "vagrantfile.",
  "jenkinsfile.",
  "justfile.",
  "brewfile.",
  "podfile.",
];

// marked 的 escape(text, true) 转义 5 个字符；renderer 收到的 codespan 文本已转义。
const unescapeMarked = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const hasKnownExtension = (text: string) => {
  const lower = text.toLowerCase();
  if (lower.endsWith(".d.ts")) return true;
  const index = lower.lastIndexOf(".");
  if (index === -1) return false;
  const ext = lower.slice(index + 1);
  if (!ext || /^\d+$/.test(ext)) return false;
  return pathExtensions.has(ext);
};

const hasKnownFileName = (text: string) => {
  const lower = text.toLowerCase();
  if (knownFileNames.has(lower)) return true;
  return knownFileNamePrefixes.some((prefix) => lower.startsWith(prefix));
};

/**
 * 判断文本是否为可点击的文件路径（启发式，不做存在性检查）。
 * 规则与 spec 边界一致：含 `/` `\` 分隔符、`./` `../` 前缀、已知扩展名、
 * 已知文件名 → path；含空白/特殊字符/纯数字后缀/非 http(s) 协议 → 否。
 */
const isClickablePath = (text: string) => {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return false; // 任何协议（URL 由另一分支处理）
  if (text === "/") return false;
  if (/^\/[a-z][a-z0-9-]*$/i.test(text)) return false; // /foo 短词
  if (/\s/.test(text)) return false;
  if (/[()[\]{}*+=<>|&^"';]/.test(text)) return false;
  if (/[/\\]/.test(text)) return true;
  if (/^\.\.?[/\\]/.test(text)) return true;
  if (hasKnownExtension(text)) return true;
  if (hasKnownFileName(text)) return true;
  return false;
};

/**
 * 从行内代码文本中提取可点击的文件路径；支持 `path:行号` 后缀拆分。
 * 返回 null 表示不是文件路径（保持纯代码样式）。输入可为 marked 转义文本
 * 或 DOM textContent（两者经 unescapeMarked 后一致）。
 */
export function extractClickablePath(
  raw: string,
): { path: string; startLine?: number } | null {
  const text = unescapeMarked(raw);

  // 行号后缀拆分：`src/main.ts:42` → path + 行号。贪婪回溯到最后一个冒号，
  // 拆分点不得是 Windows 盘符冒号（`C:\dir\file.ts:42` 应拆出 `C:\dir\file.ts`）。
  let path = text;
  let startLine: number | undefined;
  const lineMatch = /^(.+):(\d{1,6})$/.exec(text);
  if (lineMatch && !/^[A-Za-z]:$/.test(lineMatch[1]!)) {
    path = lineMatch[1]!;
    startLine = Number(lineMatch[2]);
  }

  if (!isClickablePath(path)) return null;
  return { path, startLine };
}
