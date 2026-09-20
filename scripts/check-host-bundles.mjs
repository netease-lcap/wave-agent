#!/usr/bin/env node
/**
 * 宿主产物加载自检（desktop 主进程 + VS Code 扩展宿主）。
 *
 * 为什么需要这一层：单测、demo/e2e、real-host 全都在**仓库内**跑，那里
 * `node_modules` 齐全、`@vscode/ripgrep-<platform>` 之类平台包解析得到。而宿主
 * 是**打包后才分发**的：asar 里只带 desktop 自己的生产依赖（实测 24 个顶层包），
 * 其余依赖必须已被 bundle 内联。于是"CI 全绿但装出来打不开"这类事故（v1.2.5
 * 桌面端/插件启动即崩，PR #2267 引入 barrel 导入把 @vscode/ripgrep 连坐进主进程）
 * 在测试层根本不可见。
 *
 * 两步检查，都是"产物视角"：
 *   1. 静态：产物里每个字面量 `require("<裸包名>")` 必须在允许清单内（允许清单 =
 *      打包产物真的会带、或宿主运行时真的会提供的模块）。这一步能抓到"依赖图被
 *      连坐"——即使那些 require 只在冷路径上、跑不到。
 *   2. 动态：把产物拷进一个**没有 node_modules 的临时目录**（stub 掉允许清单里的
 *      外部模块）后真加载一次。模块求值期抛错会在这里现形。
 *
 * 用法：先构建产物，再 `node scripts/check-host-bundles.mjs`（CI 见 ci.yml 的
 * host-bundle-load job）。产物缺失即失败，不静默跳过。
 */
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import Module, { createRequire, isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * `allowedExternals` = 产物可以要求宿主环境提供的裸包名（打包器 external）。
 * desktop：electron 由运行时提供，其余三项在 app.asar 的 node_modules 里实际存在
 * （electron-updater / semver / tar；见构建产物自检结论）。
 * vscode：vscode 由扩展宿主提供。
 * 清单外的裸包名一律视为"打包产物不会带"——新增依赖必须走打包内联（去掉
 * external / 加进 noExternal），而不是加进这个清单。
 */
const TARGETS = [
  {
    name: "desktop 主进程",
    file: "packages/desktop/dist/main/index.cjs",
    allowedExternals: ["electron", "electron-updater", "semver", "tar"],
    buildCommand: "pnpm -F wave-desktop exec tsup",
  },
  {
    name: "VS Code 扩展宿主",
    file: "packages/vscode/dist/extension.cjs",
    allowedExternals: ["vscode"],
    buildCommand: "pnpm -F wave-vscode run compile:backend",
  },
];

const REQUIRE_LITERAL = /\brequire\(\s*(["'])([^"'\\\n]+)\1\s*\)/g;

function packageRoot(specifier) {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}

/** 字面量 require 里出现的裸包名（去重、忽略内建与相对路径）。 */
function staticExternals(source) {
  const found = new Set();
  for (const [, , specifier] of source.matchAll(REQUIRE_LITERAL)) {
    if (isBuiltin(specifier)) continue;
    if (specifier.startsWith(".") || path.isAbsolute(specifier)) continue;
    found.add(specifier);
  }
  return found;
}

/**
 * 万能 stub：可调用、可 new、任意属性访问都返回自身、`then` 不触发回调。
 * 目的是让"需要 electron/vscode 才能走完的加载期代码"能跑过去，同时**不**让真实
 * 宿主回调被执行（那属于运行时行为，不归这里管）。
 */
function makeStub(label) {
  const handler = {
    get(_target, prop) {
      if (
        prop === Symbol.toPrimitive ||
        prop === "toString" ||
        prop === "valueOf"
      ) {
        return () => label;
      }
      if (prop === Symbol.iterator) return undefined;
      if (prop === "then") return () => stub;
      return stub;
    },
    apply: () => stub,
    construct: () => stub,
    set: () => true,
    has: () => true,
  };
  const stub = new Proxy(function () {}, handler);
  return stub;
}

/** 加载期把裸包名替换成 stub，并记录实际被 require 到的包。 */
function installLoadHook(allowed, entry) {
  const original = Module._load;
  const requested = new Set();
  Module._load = function (request, parent, isMain) {
    if (request === entry) return original.call(this, request, parent, isMain);
    if (isBuiltin(request)) return original.call(this, request, parent, isMain);
    if (request.startsWith(".") || path.isAbsolute(request)) {
      throw new Error(
        `产物在加载期 require 了相对路径 "${request}"，说明产物不是自包含的`,
      );
    }
    requested.add(request);
    const root = packageRoot(request);
    if (!allowed.includes(root)) {
      throw new Error(
        `产物在加载期 require 了 "${request}"，而打包产物不会带它（允许清单：${allowed.join(", ")}）`,
      );
    }
    return makeStub(request);
  };
  return {
    requested,
    restore() {
      Module._load = original;
    },
  };
}

const failures = [];

for (const target of TARGETS) {
  const file = path.join(repoRoot, target.file);
  if (!existsSync(file)) {
    failures.push(
      `${target.name}：产物不存在（${target.file}）——先跑 \`${target.buildCommand}\``,
    );
    continue;
  }

  const source = readFileSync(file, "utf8");
  const size = statSync(file).size;
  const allowed = new Set(target.allowedExternals);

  const offending = [...staticExternals(source)]
    .filter((s) => !allowed.has(packageRoot(s)))
    .sort();
  if (offending.length > 0) {
    failures.push(
      `${target.name}：产物静态依赖了打包产物不会带的包 → ${offending.join(", ")}\n` +
        `    （允许清单：${target.allowedExternals.join(", ")}；新增依赖请走打包内联，别改这份清单）`,
    );
  }

  // 隔离目录加载：临时目录里没有 node_modules，能加载成功就说明加载期不需要外部包。
  const dir = mkdtempSync(path.join(tmpdir(), "wave-host-bundle-"));
  const isolated = path.join(dir, path.basename(file));
  copyFileSync(file, isolated);
  const hook = installLoadHook(
    target.allowedExternals,
    `./${path.basename(file)}`,
  );
  let loaded = false;
  try {
    createRequire(path.join(dir, "entry.cjs"))(`./${path.basename(file)}`);
    loaded = true;
  } catch (error) {
    failures.push(
      `${target.name}：产物在无 node_modules 的目录里加载失败 —— 装出来就会是"打不开"。\n` +
        `    ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    hook.restore();
    rmSync(dir, { recursive: true, force: true });
  }

  const mark = offending.length === 0 && loaded ? "OK  " : "FAIL";
  const externals = [...hook.requested].sort().join(", ") || "（无）";
  console.log(
    `[${mark}] ${target.name}  ${path.relative(repoRoot, file)}  ${(size / 1024).toFixed(1)} KB  ` +
      `允许清单 ${target.allowedExternals.join("/")}  加载期实际 require：${externals}`,
  );
}

if (failures.length > 0) {
  console.error("\n宿主产物加载自检失败：\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("");
  process.exit(1);
}

console.log("\n宿主产物加载自检通过（静态依赖 + 无 node_modules 加载）。");
