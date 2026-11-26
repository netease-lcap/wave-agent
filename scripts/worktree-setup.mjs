/**
 * 让刚建好的 worktree 直接可用：补齐 node_modules，重建下游读取的产物（dist）。
 *
 * 触发方式：.wave/settings.json 的 SessionStart hook，matcher 固定在 `startup`（只在新建
 * 会话时跑，resume / clear / **compact** 都不触发），并标了 `async: true` —— 会话不等它，
 * 装依赖在后台进行。
 *
 * 为什么不走 git post-checkout：本仓的钩子归 husky 管，而 husky 的 core.hooksPath 指向它
 * 自己生成、不入库的 .husky/_，新建 worktree 里没有那个目录，git 会静默跳过所有钩子；要
 * 修就得改全局 hooksPath。SessionStart 是产品自带的钩子，不必跟 husky 抢。代价是它只覆盖
 * 「新会话」这一种入口：会话中途 EnterWorktree 进来不触发（wave 也不会为它跑 CwdChanged）。
 *
 * 输出纪律：
 * - SessionStart 的非 JSON stdout 会被整段当作上下文注入会话，所以 stdout 必须保持为空；
 * - 标了 async 的钩子，结果没人读（hookManager 直接丢弃），所以另写一份到
 *   `.git/worktree-setup.log`——出问题时先看它。
 *
 * 逃生：`WORKTREE_SETUP=0`。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 本脚本所属的检出根（= 会话所在的那个 worktree），不依赖 cwd */
const root = path.resolve(import.meta.dirname, "..");

/**
 * 子进程的 stdout 也转进 stderr，别污染 hook 的 stdout。
 * Windows 上直接 spawn `pnpm.cmd` 会被 Node 拒掉（18.20+/20.12+ 加固后 EINVAL），
 * 所以包一层 `cmd /c`；不用 `shell: true`，那条路会带上 DEP0190 警告。
 */
const run = (cmd, args) => {
  const isWindows = process.platform === "win32";
  execFileSync(
    isWindows ? "cmd.exe" : cmd,
    isWindows ? ["/c", cmd, ...args] : args,
    {
      cwd: root,
      stdio: ["ignore", 2, 2],
    },
  );
};

/** 依赖是否与锁文件对得上：装完写一份指纹，锁文件变了就重装（dev 加依赖后也走这条） */
const lockHash = () => {
  const h = createHash("sha256");
  for (const f of ["pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
    h.update(fs.readFileSync(path.join(root, f)));
  }
  return h.digest("hex").slice(0, 16);
};

const stampPath = path.join(root, "node_modules", ".worktree-setup.json");
const installedHash = () => {
  try {
    return JSON.parse(fs.readFileSync(stampPath, "utf8")).lockHash;
  } catch {
    return null;
  }
};

/** 下游包读的是产物，缺了 type-check / 测试会整片红 */
const artifacts = [
  { filter: "wave-agent-sdk", sentinel: "packages/agent-sdk/dist/agent.js" },
  { filter: "wave-webview", sentinel: "packages/webview/dist/chat.js" },
];

if (process.env.WORKTREE_SETUP === "0") {
  process.exit(0);
}

const hash = lockHash();
const needsInstall =
  !fs.existsSync(path.join(root, "node_modules")) || installedHash() !== hash;
const missing = artifacts.filter(
  (a) => !fs.existsSync(path.join(root, a.sentinel)),
);

// 没事可做就静默退出（每次新会话都会走到这里）；也别留日志文件
if (!needsInstall && missing.length === 0) {
  process.exit(0);
}

/** 落一份日志到共享的 .git/ 下：async 钩子的输出否则会彻底消失 */
const logPath = (() => {
  try {
    const dir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return path.resolve(root, dir, "worktree-setup.log");
  } catch {
    return null;
  }
})();
if (logPath) {
  try {
    fs.writeFileSync(logPath, "");
  } catch {
    // 只读检出等：日志写不了不影响正事
  }
}
const log = (msg) => {
  process.stderr.write(`worktree-setup: ${msg}\n`);
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // 同上
  }
};

if (needsInstall) {
  log(`安装依赖（${root}）...`);
  try {
    run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"]);
    fs.writeFileSync(stampPath, `${JSON.stringify({ lockHash: hash })}\n`);
  } catch (error) {
    // 锁文件与 package.json 不一致等：留个明确提示，下次会话启动会重试
    const detail =
      error instanceof Error ? error.message.split("\n")[0] : String(error);
    log(
      `pnpm install 失败，已跳过构建（${detail}）；修好后在仓库根跑 pnpm install`,
    );
    process.exit(0);
  }
}

for (const { filter, sentinel } of missing) {
  log(`产物缺失（${sentinel}），重建 ${filter} ...`);
  try {
    run("pnpm", ["-F", filter, "build"]);
  } catch {
    log(`${filter} 构建失败，依赖已就位；在仓库根跑 pnpm build 重试`);
  }
}

log(`就绪（${root}）`);
