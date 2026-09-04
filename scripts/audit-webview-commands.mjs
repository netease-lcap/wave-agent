#!/usr/bin/env node
/**
 * webview→host 消息契约护栏审计（2026-09-04 起，见报告「方向 2」）。
 *
 * 背景：webview 通过 `vscode.postMessage({ command: "xxx", ... })` 向宿主发命令，
 * 各宿主在 4 个路由实例各自注册处理（vscode chat 路由 / vscode settings tab 路由 /
 * desktop 单路由 / jetbrains 单 when）。命令字面量过去散落 webview，host 漏接
 * 编译期不报，用户点到才爆（#2086 getProjectSettings/setBuiltinPluginEnabled 漏
 * settings 路由、JB backgroundCurrentTask 漏接等）。
 *
 * 本脚本做静态覆盖审计，漏接即非零退出（CI 红）：
 *   1) 扫 packages/webview/src 所有发送点（剥注释后匹配 `command: "X"` 字面量），
 *      并按发送文件归类到 surface（chat / settings / desktop-chrome）。
 *   2) 扫 4 个路由实例的 case/when 注册集合。
 *   3) 按「surface → 必达路由」规则断言每个可达命令两端都已注册；并反查 host 侧
 *      独有 case（webview 永不发送的），只允许出现在下方 LEGACY_HOST_CASES 清单
 *      （已确认的遗留/宿主主动发起命令），否则视为新增死注册并报错。
 *
 * 标准流程（新增命令 / 新增路由 handler 时）：
 *   - 新增 webview 发送命令：在组件里加 `postMessage({ command: "newCmd", ... })`
 *     字面量 → 跑 `node scripts/audit-webview-commands.mjs` 会列出它在哪些宿主路由
 *     漏注册 → 逐个补齐（chat 类补 vscode_chat+desktop+jetbrains，设置页类还要补
 *     vscode settings 路由）。
 *   - host 侧主动发起/遗留命令（webview 不发，如 getAuthStatus/getWorkflowRuns）：
 *     不会漏报；但若在 host 开关里新增一个 webview 永不发送的 case，本脚本会红，
 *     需把它登记进 LEGACY_HOST_CASES（附注释）或删除该 case。
 *   - 清理 host 死注册：先从 LEGACY_HOST_CASES 摘除再删 case。
 *
 * 已知保守偏差：ChatApp.tsx 同时是 desktop 设置全页的宿主（isDesktop 分支内发
 * getConfiguration/getAgentsContent），静态扫描无法识别该门控，因此这类命令会
 * 同时要求 vscode_chat 路由注册（现状 vscode 确实保留着 legacy 副本）。待方向
 * 3（路由表驱动收拢）落地时再把这类命令移入 SPECIFIC_REQUIREMENTS 修正。
 *
 * 用法：node scripts/audit-webview-commands.mjs   （exit 0 = 通过）
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WEBVIEW_SRC = join(ROOT, "packages/webview/src");

// ────────────────────────────────────────────────────────────────────────────
// 4 个路由实例：host 处理注册点（webview→host 方向）
// ────────────────────────────────────────────────────────────────────────────
const HOST_FILES = {
  vscode_chat: {
    path: join(ROOT, "packages/vscode/src/session/messageHandler.ts"),
    label: /^\s*case "/,
  },
  vscode_settings: {
    path: join(ROOT, "packages/vscode/src/session/messageHandler.ts"),
    label: /^\s*case "/,
  },
  desktop: {
    path: join(ROOT, "packages/desktop/src/main/desktopHost.ts"),
    label: /^\s*case "/,
  },
  jetbrains: {
    path: join(
      ROOT,
      "packages/jetbrains/src/main/kotlin/com/wave/jetbrains/session/MessageHandler.kt",
    ),
    label: /^\s*"[A-Za-z][A-Za-z0-9_]*" ->/,
  },
};

/**
 * 已确认的 host 侧 legacy/dead case —— webview 当前永不发送但仍注册在路由里。
 * 保留原因两类：①历史遗留（插件旧协议 deleteQueuedMessage/enablePlugin/
 * disablePlugin、settings 旧请求 getHooksConfig/getMcpConfig）②宿主主动发起
 * （getAuthStatus/getWorkflowRuns/listSessions 由 host 在 webviewReady 等时机
 * 自调、desktopPreviewState 旧协议）。新出现的 host-only case 必须补进此表，
 * 否则审计红（见文件头「标准流程」）。
 */
const LEGACY_HOST_CASES = {
  vscode_chat: new Set([
    "deleteQueuedMessage", // 历史遗留：webview 已改用 deleteQueuedMessageById
    "enablePlugin", // 历史遗留：插件启停已并入 install/uninstall + setBuiltinPluginEnabled
    "disablePlugin", // 同上
    "getAuthStatus", // 宿主主动发起：webviewReady 后 host 自查登录态
    "getWorkflowRuns", // 宿主主动发起 / 轮询
    "listSessions", // 宿主主动发起：聊天面板初始化时 host 拉会话列表
  ]),
  vscode_settings: new Set([
    "getHooksConfig", // 历史遗留 settings 请求（现走 getHooksByScope）
    "getMcpConfig", // 历史遗留 settings 请求（现走 getMcpServers）
  ]),
  desktop: new Set([
    "deleteQueuedMessage", // 历史遗留，同 vscode_chat
    "desktopPreviewState", // 历史遗留：预览面板旧协议（webview 现用 desktopPanelState）
    "enablePlugin", // 历史遗留，同 vscode_chat
    "disablePlugin", // 同上
    "getAuthStatus", // 宿主主动发起，同 vscode_chat
    "getHooksConfig", // 历史遗留，同 vscode_settings
    "getMcpConfig", // 历史遗留，同 vscode_settings
    "getWorkflowRuns", // 宿主主动发起，同 vscode_chat
  ]),
  jetbrains: new Set([
    "deleteQueuedMessage", // 历史遗留，同 vscode_chat
    "enablePlugin", // 历史遗留，同 vscode_chat
    "disablePlugin", // 同上
    "getAuthStatus", // 宿主主动发起：webviewReady 自查登录态
    "getHooksConfig", // 历史遗留，同 vscode_settings
    "getMcpConfig", // 历史遗留，同 vscode_settings
    "getWorkflowRuns", // 宿主主动发起
    "listSessions", // 宿主主动发起，同 vscode_chat
  ]),
};

/**
 * 桌面专属命令（webview 在 IDE 宿主绝不发送，只要求 desktop 注册）。
 * 分两类：desktop* 前缀自动命中 + 少数非前缀但同样 isDesktop 门控的。
 */
const DESKTOP_GATED_NON_PREFIX = new Set([
  "checkForUpdates", // StatusDialog 仅 desktop 渲染（扩展更新走官方市场）
  "newSession", // ChatApp.handleDesktopNewSession（IDE 头部的「新对话」= clearChat）
  "setThemeSource", // 设置页主题行仅 desktop 有 UI
  "toastAction", // UpdateToast 仅 desktop 推送
]);

/**
 * 按发送表面划分时无法从文件路径推出的特例命令 → 显式路由要求（覆盖推导）。
 * 推导规则默认：有 chat 发送方 → 要求 vscode_chat + jetbrains；有 settings
 * 发送方 → 要求 vscode_settings + jetbrains；非 gated 非 IDE-only → 要求 desktop。
 * 下面这些命令的发送方文件路径归类会失真（desktop 全页设置/IDE tab 差异、
 * ChatApp 双角色、host 层拦截等），逐一显式修正。
 */
const SPECIFIC_REQUIREMENTS = {
  // settings tab（settings-preview-entry bundle）专用，仅 IDE 宿主有该外壳：
  // desktop 全页设置不用 postMessage 关自己/预填（内部 state/prop 直达）。
  closeSettings: { vscode_settings: true, jetbrains: true },
  prefillPrompt: { vscode_settings: true, jetbrains: true },
  // settingsReady 在 vscode 由 chatProvider 面板监听层拦截（messageHandler.ts
  // switch 之外）触发 settingsState 重发；JB 用 JCEF onLoadEnd 补偿、desktop 无
  // 该 entry，均不需要路由 case。
  settingsReady: { vscode_settings: true },
  // IDE chat 外壳点「设置」→ postMessage openSettings 让 host 开编辑器区
  // settings tab；desktop 全页设置是内部 state 切换，不发消息。
  openSettings: { vscode_chat: true, jetbrains: true },
};

/**
 * 在 host 路由 switch/when 之外拦截处理的命令（处理点不在 HOST_FILES 扫的注册
 * 集合内，但命令确实被 host 消费）——纳入对应路由的「已处理」集合。
 */
const HANDLED_OFF_SWITCH = {
  vscode_settings: new Set([
    // settings-preview-entry 挂载后报 settingsReady → chatProvider.ts 面板消息
    // 监听器（约 :113）拦截并重发缓存的 settingsState，不落入 handleSettingsMessage。
    "settingsReady",
  ]),
};

// ────────────────────────────────────────────────────────────────────────────
// 工具：剥注释（保留字符串与代码，仅把注释替换成空白，行号对齐便于报错）
// ────────────────────────────────────────────────────────────────────────────
function stripComments(src) {
  let out = "";
  let state = "code";
  let quote = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        out += "  ";
        i++;
      } else if (ch === "/" && next === "*") {
        state = "block";
        out += "  ";
        i++;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        state = "str";
        quote = ch;
        out += ch;
      } else {
        out += ch;
      }
    } else if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += ch;
      } else out += " ";
    } else if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        out += "  ";
        i++;
      } else out += ch === "\n" ? "\n" : " ";
    } else {
      out += ch;
      if (ch === "\\" && i + 1 < src.length) {
        out += src[i + 1];
        i++;
      } else if (ch === quote) {
        state = "code";
        quote = "";
      }
    }
  }
  return out;
}

const CMD_RE = /["']?command["']?\s*:\s*"([A-Za-z][A-Za-z0-9_]*)"/g;
const HAS_SEND_RE = /postToHost\s*\(|postMessage\s*\(/;
const SEND_CALL_RE = /vscode\??\.postMessage\s*\(|postToHost\s*\(/;

// ────────────────────────────────────────────────────────────────────────────
// 1) 提取 webview 发送面：cmd → 发送文件集合
// ────────────────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (
      /\.(ts|tsx)$/.test(name) &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.tsx")
    )
      out.push(p);
  }
  return out;
}

/** 发送文件按渲染外壳归类：settings 外壳 / desktop 专属外壳 / 其余（chat 系）。 */
function surfaceOf(file) {
  const rel = relative(WEBVIEW_SRC, file);
  const base = rel.split(/[\\/]/).pop();
  if (
    base === "settings-preview-entry.tsx" ||
    /^Settings[A-Za-z0-9]*\.tsx$/.test(base)
  )
    return "settings";
  if (
    base.startsWith("Desktop") ||
    base.endsWith("Pane.tsx") ||
    base.startsWith("Panel") ||
    /^BackgroundTaskManager\.tsx$/.test(base)
  ) {
    return "chrome";
  }
  return "chat";
}

function collectWebviewCommands() {
  const senderByCmd = new Map(); // cmd -> Set(relpath)
  const filesWithSends = [];
  for (const file of walk(WEBVIEW_SRC)) {
    const text = stripComments(readFileSync(file, "utf8"));
    if (!HAS_SEND_RE.test(text)) continue; // 无发送语义的文件直接跳过
    const rel = relative(WEBVIEW_SRC, file);
    const cmds = [...text.matchAll(CMD_RE)].map((m) => m[1]);
    if (!cmds.length) continue;
    // 反推自检：有 command 字面量但文件里没有任何发送调用 → 扫描假设被破坏。
    if (!SEND_CALL_RE.test(text)) {
      console.error(
        `  ! 文件 ${rel} 含 command 字面量但未发现 postMessage/postToHost 调用（请人工核查）`,
      );
      process.exitCode = 1;
    }
    filesWithSends.push(rel);
    for (const c of new Set(cmds)) {
      if (!senderByCmd.has(c)) senderByCmd.set(c, new Set());
      senderByCmd.get(c).add(rel);
    }
  }
  return { senderByCmd, filesWithSends };
}

// ────────────────────────────────────────────────────────────────────────────
// 2) 提取 4 个路由实例的注册集合
// ────────────────────────────────────────────────────────────────────────────
function collectHostCases() {
  const result = {};
  const vscode = readFileSync(HOST_FILES.vscode_chat.path, "utf8").split("\n");
  // vscode 单文件双路由：handleSettingsMessage(479) 之前的 case 归 chat 路由。
  const settingsMarker = vscode.findIndex((l) =>
    /public async handleSettingsMessage/.test(l),
  );
  const chatSet = new Set();
  const settingsSet = new Set();
  vscode.forEach((line, idx) => {
    const m = line.match(/^\s*case "([A-Za-z][A-Za-z0-9_]*)":/);
    if (!m) return;
    (idx < settingsMarker ? chatSet : settingsSet).add(m[1]);
  });
  result.vscode_chat = chatSet;
  result.vscode_settings = settingsSet;

  const desktop = new Set();
  for (const line of readFileSync(HOST_FILES.desktop.path, "utf8").split(
    "\n",
  )) {
    const m = line.match(/^\s*case "([A-Za-z][A-Za-z0-9_]*)":/);
    if (m) desktop.add(m[1]);
  }
  result.desktop = desktop;

  const jb = new Set();
  for (const line of readFileSync(HOST_FILES.jetbrains.path, "utf8").split(
    "\n",
  )) {
    const m = line.match(/^\s*"([A-Za-z][A-Za-z0-9_]*)"\s*->/);
    if (m) jb.add(m[1]);
  }
  result.jetbrains = jb;
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// 3) 断言
// ────────────────────────────────────────────────────────────────────────────
function requiredRoutes(cmd, senderSurfaces) {
  if (cmd.startsWith("desktop") || DESKTOP_GATED_NON_PREFIX.has(cmd)) {
    return ["desktop"]; // 桌面专属：webview 在 IDE 从不发送
  }
  const spec = SPECIFIC_REQUIREMENTS[cmd];
  if (spec) return Object.keys(spec).filter((r) => spec[r]);

  const routes = new Set();
  if (senderSurfaces.chat.length || senderSurfaces.chrome.length) {
    // chat 系组件在 IDE 聊天 webview 里运行（vscode chat 路由 / jb）。
    routes.add("vscode_chat");
    routes.add("jetbrains");
  }
  if (senderSurfaces.settings.length) {
    // Settings*View 在 IDE settings tab 外壳里运行（vscode settings 路由 / jb）。
    routes.add("vscode_settings");
    routes.add("jetbrains");
  }
  // desktop：单路由覆盖 chat 全页设置 + 所有组件（除非命令在 desktop 外壳不发）。
  if (cmd !== "openSettings") routes.add("desktop");
  return [...routes];
}

const problems = [];
let checked = 0;

function check(hostCases, cmd, routes, senderByCmd) {
  for (const route of routes) {
    checked++;
    if (!hostCases[route].has(cmd)) {
      problems.push(
        `  [缺失] ${cmd.padEnd(24)} 要求注册在 ${route}，但 ${HOST_FILES[route].path.replace(ROOT, "")} 未处理\n` +
          `         webview 发送方: ${[...senderByCmd.get(cmd)].join(", ")}`,
      );
    }
  }
}

function main() {
  const { senderByCmd } = collectWebviewCommands();
  const hostCases = collectHostCases();
  // switch 外拦截处理的命令并入「已处理」集合（见 HANDLED_OFF_SWITCH 注释）。
  for (const [route, cmds] of Object.entries(HANDLED_OFF_SWITCH)) {
    for (const c of cmds) hostCases[route].add(c);
  }

  // 汇总每个命令的发送表面（去重文件集合）
  const surfacesByCmd = new Map();
  for (const [cmd, files] of senderByCmd) {
    const buckets = { chat: [], settings: [], chrome: [] };
    for (const f of files) buckets[surfaceOf(f)].push(f);
    surfacesByCmd.set(cmd, buckets);
  }

  // 3a) 正向：webview 可达命令 × 必达路由
  for (const [cmd, surfaces] of surfacesByCmd) {
    const routes = requiredRoutes(cmd, surfaces);
    check(hostCases, cmd, routes, senderByCmd);
  }

  // 3b) 反向：host 独有 case（webview 永不发送）必须登记在 LEGACY_HOST_CASES
  const universe = new Set(senderByCmd.keys());
  for (const [route, cases] of Object.entries(hostCases)) {
    for (const c of cases) {
      if (universe.has(c)) continue;
      if (!LEGACY_HOST_CASES[route].has(c)) {
        problems.push(
          `  [死注册] ${route} 处理了 webview 永不发送的命令 "${c}"（${HOST_FILES[route].path.replace(ROOT, "")}）。\n` +
            `         若为宿主主动发起/历史遗留，请登记进脚本 LEGACY_HOST_CASES[${route}]（附注释）；否则删除该 case。`,
        );
      }
    }
  }

  // 汇报
  console.log(
    `webview→host 命令审计（${universe.size} 条 webview 发送命令，${checked} 条路由要求）`,
  );
  if (problems.length) {
    console.log(`\n✗ 发现 ${problems.length} 处路由漏接/死注册：\n`);
    console.log([...new Set(problems)].join("\n"));
    process.exit(1);
  }
  console.log(
    "✓ 4 个路由实例（vscode_chat / vscode_settings / desktop / jetbrains）覆盖完整",
  );
  console.log("✓ host 独有 case 全部登记在 legacy 豁免清单");
}

main();
