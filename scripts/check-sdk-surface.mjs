#!/usr/bin/env node
/**
 * SDK 公共面 / 宿主边界自检。
 *
 * 为什么需要这一层：宿主（desktop 主进程、VS Code 扩展宿主）只通过 JSON-RPC 驱动
 * CLI 子进程，**不能**把 agent 运行时打进自己的 bundle。但这条纪律过去只是约定：
 * v1.2.5 一次「为复用两条文案而从桶入口 import」就让宿主把整个 SDK 图连坐进产物，
 * 其中的 `@vscode/ripgrep` wrapper 在模块求值期抛错（平台包只在 CLI 侧按需下载），
 * 于是桌面端与插件「装出来打不开」（PR #2267 引入、#2281/#2283 修复）。
 *
 * 四项检查，全部只看"依赖与入口的形状"，不看宿主产物：
 *   1. 导入面：宿主包只能从允许的 SDK 子路径导入（desktop/vscode → `/host`，
 *      webview → `/types`）。桶入口与 `dist/...` 深路径都算违规。
 *   2. 闭包：`/host` 入口沿相对导入走完的依赖闭包必须**零第三方依赖**且有体积预算。
 *   3. 可选平台包：把 `@vscode/*` 从解析环境里去掉后，每个 SDK 入口仍必须能加载
 *      （可选依赖只允许惰性解析，禁止顶层 import/export-from）。
 *   4. 声明：`sideEffects: false` 在位。它是第 3 项之外的兜底——即使有人误从桶入口
 *      取值，打包器也能把整张图摇掉（实测 2.16 MB → 9.7 KB）。
 *
 * 用法：先 `pnpm -F wave-agent-sdk build`，再 `node scripts/check-sdk-surface.mjs`
 * （CI 见 ci.yml 的 sdk-surface job）。dist 缺失即失败，不静默跳过。
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sdkDir = path.join(repoRoot, "packages/agent-sdk");
const distDir = path.join(sdkDir, "dist");
const failures = [];

/**
 * 各包允许的 SDK 导入面。宿主需要新的共享值时：**先把它放进 `/host`**，而不是
 * 放宽这里或去 import 桶入口。
 *
 * - desktop / vscode：驱动 agent 的宿主，只能拿 `/host`（RPC 层 + 类型 + 常量）。
 * - webview：纯 UI（跑在宿主 webview 里，不驱动 agent），只允许类型与工具名常量；
 *   它过去有 6 处 `from "wave-agent-sdk"` 桶导入（`import type`，编译期擦除，但正是
 *   这次事故的同一种写法）与 9 处 `dist/...` 深路径导入。
 * - webview-fixtures：测试契约包，只用类型。
 * - `packages/code`（CLI）是桶入口的唯一正当消费者，故意不在表内。
 */
const HOST_IMPORT_ALLOWLIST = {
  "packages/desktop": ["wave-agent-sdk/host"],
  "packages/vscode": ["wave-agent-sdk/host"],
  "packages/webview": ["wave-agent-sdk/types", "wave-agent-sdk/constants"],
  "packages/webview-fixtures": ["wave-agent-sdk/types"],
};

/** `/host` 闭包允许出现的裸包名：只有 Node 内建（SDK 内建工具之外它不该有依赖）。 */
const HOST_CLOSURE_ALLOWED = [];
/** `/host` 闭包源码体积上限（当前实测约 20 KB，留一个数量级的余量）。 */
const HOST_CLOSURE_BUDGET = 200 * 1024;

/**
 * 逐个入口检查"可选平台包缺席时能否加载"。表=package.json exports 里**有 subpath** 的
 * 那几条（`./stdio` 已收口，只经 `/host` 可达，故不单列——`/host` 会把它一起加载）。
 */
const ENTRIES = {
  "": "index.js",
  types: "types/index.js",
  constants: "constants/index.js",
  host: "host/index.js",
};

const QUOTED_SPECIFIER_FROM_RE =
  /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm;
const BARE_IMPORT_RE = /^[ \t]*import\s*["']([^"']+)["']/gm;

/**
 * 去掉注释再取模块说明符。必须去注释：SDK 里有大量文档注释同时含 "export" 与引号内
 * 路径（例如 `./types/index.js` 这类举例），不处理会被当成依赖。
 */
function stripComments(source) {
  let out = "";
  let quote = null;
  for (let i = 0; i < source.length; ) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      if (char === "\\") {
        out += char + (next ?? "");
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      out += char;
      i += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (
        i < source.length &&
        !(source[i] === "*" && source[i + 1] === "/")
      ) {
        i += 1;
      }
      i += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    out += char;
    i += 1;
  }
  return out;
}

function specifiersOf(source) {
  const code = stripComments(source);
  const found = [];
  for (const re of [QUOTED_SPECIFIER_FROM_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    for (const match of code.matchAll(re)) {
      found.push({ specifier: match[1], index: match.index ?? 0 });
    }
  }
  return found;
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// ── 1. 宿主导入面 ────────────────────────────────────────────────────────────
let importChecked = 0;
for (const [pkg, allowed] of Object.entries(HOST_IMPORT_ALLOWLIST)) {
  const srcDir = path.join(repoRoot, pkg, "src");
  if (!existsSync(srcDir)) continue;
  for (const file of sourceFiles(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const { specifier, index } of specifiersOf(source)) {
      if (!specifier.startsWith("wave-agent-sdk")) continue;
      importChecked += 1;
      if (allowed.includes(specifier)) continue;
      failures.push(
        `${path.relative(repoRoot, file)}:${lineOf(source, index)} 导入了 "${specifier}"，` +
          `不在 ${pkg} 允许的导入面内（${allowed.join(", ")}）`,
      );
    }
  }
}
console.log(
  `[INFO] 宿主导入面：扫描 ${Object.keys(HOST_IMPORT_ALLOWLIST).length} 个包、` +
    `${importChecked} 处 SDK 导入`,
);

// ── 2. `/host` 闭包 ─────────────────────────────────────────────────────────
const hostEntry = path.join(distDir, "host/index.js");
if (!existsSync(hostEntry)) {
  failures.push(
    "packages/agent-sdk/dist/host/index.js 不存在 —— 先跑 `pnpm -F wave-agent-sdk build`",
  );
} else {
  const seen = new Set();
  const bare = new Map();
  let bytes = 0;
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    bytes += statSync(file).size;
    for (const { specifier } of specifiersOf(source)) {
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        if (!existsSync(target)) {
          failures.push(
            `/host 闭包引用了不存在的文件：${path.relative(repoRoot, file)} → ${specifier}`,
          );
          continue;
        }
        walk(target);
        continue;
      }
      const root = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier.split("/")[0];
      if (isBuiltin(specifier) || isBuiltin(root)) continue;
      bare.set(root, specifier);
    }
  };
  walk(hostEntry);

  const offending = [...bare.keys()].filter(
    (root) => !HOST_CLOSURE_ALLOWED.includes(root),
  );
  if (offending.length > 0) {
    failures.push(
      `/host 闭包引入了第三方依赖 → ${offending.map((r) => bare.get(r)).join(", ")}\n` +
        `    （宿主只该拿到 RPC 层 + 类型 + 常量；需要别的值时请先判断它是否真属于宿主面）`,
    );
  }
  if (bytes > HOST_CLOSURE_BUDGET) {
    failures.push(
      `/host 闭包 ${(bytes / 1024).toFixed(1)} KB 超出预算 ${HOST_CLOSURE_BUDGET / 1024} KB`,
    );
  }
  const mark =
    offending.length === 0 && bytes <= HOST_CLOSURE_BUDGET ? "OK  " : "FAIL";
  console.log(
    `[${mark}] ${"/host 闭包".padEnd(14)} ${seen.size} 个模块 ${(bytes / 1024).toFixed(1)} KB  ` +
      `第三方依赖：${offending.length === 0 ? "（无）" : offending.join(", ")}`,
  );
}

// ── 3. 可选平台包缺席时的入口加载 ───────────────────────────────────────────
if (existsSync(distDir)) {
  const isolated = mkdtempSync(path.join(tmpdir(), "wave-sdk-surface-"));
  try {
    cpSync(distDir, path.join(isolated, "dist"), { recursive: true });
    // 只链接 SDK 自己的依赖，**故意不链 @vscode/***：平台包是宿主运行时按需下载的，
    // 任何入口都不该在加载期需要它。
    const nodeModules = path.join(isolated, "node_modules");
    mkdirSync(nodeModules);
    const sdkNodeModules = path.join(sdkDir, "node_modules");
    for (const entry of readdirSync(sdkNodeModules, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "@vscode") continue;
      if (!entry.name.startsWith("@") || !entry.isDirectory()) {
        symlinkSync(
          path.join(sdkNodeModules, entry.name),
          path.join(nodeModules, entry.name),
        );
        continue;
      }
      mkdirSync(path.join(nodeModules, entry.name));
      for (const inner of readdirSync(path.join(sdkNodeModules, entry.name))) {
        if (`${entry.name}/${inner}`.startsWith("@vscode/")) continue;
        symlinkSync(
          path.join(sdkNodeModules, entry.name, inner),
          path.join(nodeModules, entry.name, inner),
        );
      }
    }

    for (const [name, distFile] of Object.entries(ENTRIES)) {
      const file = path.join(isolated, "dist", distFile);
      if (!existsSync(file)) {
        failures.push(`SDK 入口 dist/${distFile} 不存在`);
        continue;
      }
      const script = `await import(${JSON.stringify(pathToFileURL(file).href)});`;
      try {
        execFileSync(process.execPath, ["--input-type=module", "-e", script], {
          cwd: isolated,
          stdio: ["ignore", "ignore", "pipe"],
        });
        console.log(
          `[OK  ] ${`入口 ${name || "index"}`.padEnd(14)} 无 @vscode/* 时可加载`,
        );
      } catch (error) {
        const stderr = String(error.stderr ?? error.message)
          .trim()
          .split("\n")[0];
        failures.push(
          `SDK 入口 ${name || "index"} 在缺少 @vscode/* 的解析环境下加载失败 —— ` +
            `可选平台依赖只能惰性解析（createRequire + try/catch），不能顶层 import。\n    ${stderr}`,
        );
        console.log(
          `[FAIL] ${`入口 ${name || "index"}`.padEnd(14)} 无 @vscode/* 时加载失败`,
        );
      }
    }
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
}

// ── 4. sideEffects 声明 ────────────────────────────────────────────────────
const sdkPkg = JSON.parse(
  readFileSync(path.join(sdkDir, "package.json"), "utf8"),
);
if (sdkPkg.sideEffects !== false) {
  failures.push(
    'packages/agent-sdk/package.json 缺少 "sideEffects": false —— ' +
      "没有它，打包器必须假设桶入口的每个 re-export 都有副作用，一次「顺手 import 桶」" +
      "就会把整套运行时拖进宿主 bundle（实测 2.16 MB）。",
  );
} else {
  console.log(`[OK  ] ${"sideEffects".padEnd(14)} 声明在位`);
}

// ── 5. exports 的 subpath 表与上面的 ENTRIES 一致 ──────────────────────────
// ENTRIES 是手写的，漏登记一个 subpath，第 3 项检查就会**静默**跳过它（@vscode 地雷
// 正是从某个未被检查的入口漏进宿主产物的）。所以强制两者相等：新增 subpath 必须
// 同步登记，否则这里红。
const exportedSubpaths = Object.keys(sdkPkg.exports ?? {})
  .filter((key) => key !== "." && key !== "./package.json" && key !== "./*")
  .map((key) => key.replace(/^\.\//, ""))
  .sort();
const checkedEntries = Object.keys(ENTRIES)
  .filter((name) => name !== "")
  .sort();
if (exportedSubpaths.join(",") !== checkedEntries.join(",")) {
  failures.push(
    `package.json exports 的 subpath 与自检入口表不一致：` +
      `exports=[${exportedSubpaths.join(", ")}]，ENTRIES=[${checkedEntries.join(", ")}] —— ` +
      "新增 subpath 必须同步登记到本脚本的 ENTRIES。",
  );
} else {
  console.log(
    `[OK  ] ${"exports".padEnd(14)} subpath 已全部登记（${exportedSubpaths.length} 个）`,
  );
}

if (failures.length > 0) {
  console.error("\nSDK 公共面自检失败：\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("");
  process.exit(1);
}

console.log(
  "\nSDK 公共面自检通过（导入面 + /host 闭包 + 可选依赖 + exports 一致 + sideEffects）。",
);
