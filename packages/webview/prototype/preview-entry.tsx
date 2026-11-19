/// <reference types="vite/client" />
/**
 * webview 原型预览入口（Vite dev server / build 共用，非产品功能）。
 *
 * 复用真实 src/ 组件（ChatApp/DesktopApp）与样式（globals + codicons），
 * 主题变量来自 packages/webview/theme/theme-base-{light,dark}.css（vite 插件
 * 已改写为 :root[data-theme=...]，与 desktop syncWebview 同一机制）。
 *
 * HMR 语义：
 * - 改 src/ 组件 → React Fast Refresh（保留状态）
 * - 改 src/ CSS → 即时生效
 * - 改 mock/ 用例 → 自动整页重载并重放当前用例（无需手动刷新）
 *
 * mock 用例在 prototype/mock/*.ts（gitignore，仅本地），工具条切换，切换后
 * 按用例脚本注入 host → webview 消息，并按 responders 响应 webview → host
 * 请求。webviewReady gating 对齐 e2e messageInjector。
 *
 * 用例切换机制：state 驱动 + key 重挂载（等同 reload 语义），而非
 * sessionStorage + location.reload()——因为 build 产物用于 artifact 时跑在
 * srcdoc sandbox（origin null）里，sessionStorage 访问即抛 SecurityError、
 * reload 也会重置回初始内容，两者都不可用。所有存储访问都走 readSession/
 * writeSession 降级：dev 有存储（记忆上次用例/拖拽位置），沙箱无存储则回退
 * 默认。
 */
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatApp } from "../src/components/ChatApp";
import { DesktopApp } from "../src/components/DesktopApp";
import "../src/styles/globals.css";
import "../src/styles/host-desktop.css";
import "@vscode/codicons/dist/codicon.css";
import "../theme/theme-base-light.css";
import "../theme/theme-base-dark.css";
// 远控 Web 页（移动端档）的样式：真机由 remote/build.mjs 打进 chat.js 旁的
// chat.css，这里直接引源码。**必须排在 theme-base 之后**——远控页的手机档是靠
// `[data-remote-page][data-theme]` 覆写 `--vscode-font-size` 等 token 的，与主题的
// `:root[data-theme="dark"]` 特异性相同、靠源码顺序取胜；真机的 pageCss 也是
// 「两份主题在前、chat.css 在后」（remote/build.mjs 的 emit）。放在前面会让手机档
// 的 token 静默输给主题值。它只在 data-remote-page 命中时生效，另两端零影响。
import "../src/styles/remote-page.css";
// 工具条自己的样式（浮层面 + 28px 字段档 + 深色 color-scheme）。全部挂在 `.pv-*`
// 上，不进产品命名空间；排最后，免得被上面几张表里同特异性的规则抢先。
import "./preview-bar.css";
import type { MockCase, MockHelpers } from "./types";
import {
  CASE_STORAGE_KEY,
  NoCaseNotice,
  SelectionBadges,
  caseKeysFromModules,
  resolveInitialCase,
  type CaseSelection,
} from "./caseSelection";

// ── mock 用例（prototype/mock/*.ts，gitignore；修改自动热更新）──────────
const mockModules = import.meta.glob<{ default: MockCase }>("./mock/*.ts", {
  eager: true,
});
const mockCases = Object.entries(mockModules).map(([file, mod]) => ({
  key: file.slice("./mock/".length, -3),
  name: mod.default.name,
}));

// mock vscode API 全局（由 prototype/index.html 的 inline 脚本定义）
interface MockGlobals {
  __waveMockReady: boolean;
  __waveMockReadyCallbacks: Array<() => void>;
  __waveMockResponders: Record<
    string,
    (payload: Record<string, unknown>, helpers: MockHelpers) => void
  >;
  __waveMockSendAfter: (ms: number, message: Record<string, unknown>) => void;
  __waveMockCancelPending: () => void;
}
const mockWin = window as unknown as MockGlobals;

// 页面加载时的宿主类型（真机由 Electron preload 在 bundle 之前写入）。只在
// 首屏取一次：下面同步宿主类型的 effect 会把 window.waveHostType 写成当前用例
// 的值，若每次都实时读它，切到桌面用例后就再也回不到插件端用例（选择变成单向）。
const initialHostType = window.waveHostType;

// ── 存储助手：srcdoc 沙箱无存储，访问即抛 SecurityError，整体降级 ──
const readSession = (k: string): string | null => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeSession = (k: string, v: string) => {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* 沙箱无存储，静默 */
  }
};

// ── 初始用例（模块顶层，render 前确定；responders 先于子树挂载注册）──
// 默认加载「桌面端-新对话」用例，避免打开原型预览看到无限扫光 loading
// （ChatApp 无任何宿主消息时停留在 showWelcome）。dev 下记住上次选择。
//
// 记住的 key 必须校验仍然存在：mock/ 是 gitignore 的本地目录，文件随时会被删/改名。
// 而 sessionStorage 按 origin+会话隔离——分享出去的 artifact、以及被宿主当成全新
// 页面加载的 guest（desktop 预览面板）都读不到上次的选择，每次都要重走回退链。
// 回退由 resolveInitialCase 统一决定，并把「兜底选中 / 上次失效 / 一个都没有」
// 变成工具条与正文能看见的状态，而不是静默留一片黑（见 caseSelection.tsx）。
const getCase = (key: string) =>
  key ? mockModules[`./mock/${key}.ts`]?.default : undefined;
const mockKeys = caseKeysFromModules(mockModules);
const initialSelection = resolveInitialCase(
  mockKeys,
  readSession(CASE_STORAGE_KEY),
);
mockWin.__waveMockResponders = getCase(initialSelection.key)?.responders || {};

// ── 错误边界：用例渲染崩溃时保住工具条（还能切走）──────────────────
class PreviewBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            color: "var(--vscode-errorForeground, #f48771)",
            font: "13px sans-serif",
          }}
        >
          用例渲染出错：{this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

// ── 宿主三档：桌面端 / 插件端 / 移动端 ─────────────────────────────────
// 用例可以自带 host（mock 里声明），工具条的下拉是**临时覆盖**：换用例即回到它
// 自带的端，免得上一轮手选的端串到下一份用例上。
type PreviewHost = "desktop" | "editor" | "remote";

const HOST_OPTIONS: ReadonlyArray<{ value: PreviewHost; label: string }> = [
  { value: "desktop", label: "桌面端" },
  { value: "editor", label: "插件端" },
  { value: "remote", label: "移动端" },
];

/** 用例声明的宿主 → 三档。mock 里的 "plugin" / "ide" 是 "editor" 的同义词。 */
function caseHostOf(activeCase: MockCase | undefined): PreviewHost {
  if (activeCase?.host === "desktop") return "desktop";
  if (activeCase?.host) return "editor";
  return initialHostType === "desktop" ? "desktop" : "editor";
}

/**
 * 把宿主写进全局与 <html>——必须在子树 render **之前**调用。
 *
 * `isDesktopHost()` / `isRemotePageHost()` 是在 render 里读的（ChatApp 直接调），
 * 放在 useEffect 里就晚了一拍：子树先按旧标记渲染完、标记再改，而 host 是父组件的
 * 常量、不会再触发渲染，要等一条宿主消息把状态推一下才自愈。所以做成幂等赋值，
 * 在组件体里直接调。
 *
 * 移动端一档逐项对齐 `remote/shim.js`：`waveHostType` 故意**不设**（远控页不归属
 * 任何一端）、`waveRemotePage = true`、`data-remote-page="1"`；密度档仍落
 * `data-host="editor"`（远控页属于插件端那一档，见 src/index.tsx 与
 * src/styles/remote-page.css 头注释）。桌面端的 data-host 是 host-desktop.css 的
 * 桌面语义层开关（--cc-* → --vscode-* 桥接），缺了它预览会退回 theme-base 的
 * VS Code 配色（蓝按钮等），与真机观感不一致。
 */
function applyHost(host: PreviewHost) {
  const root = document.documentElement;
  if (host === "remote") {
    window.waveHostType = undefined;
    setRemotePageFlag(true);
    root.setAttribute("data-remote-page", "1");
    root.dataset.host = "editor";
    hoistRemotePageSheet();
    return;
  }
  setRemotePageFlag(false);
  window.waveHostType = host;
  root.removeAttribute("data-remote-page");
  root.dataset.host = host;
}

/**
 * 把 dev 下 Vite 注入的 remote-page.css 那张表挪到 <head> 末尾。
 *
 * 为什么需要：远控页的手机档靠 `[data-remote-page][data-theme]` 覆写
 * `--vscode-font-size` / `--vscode-editor-font-size`，它与主题的
 * `:root[data-theme="…"]` **特异性相同**，靠源码顺序决胜。真机的 pageCss 是
 * 「两份主题在前、chat.css 在后」（remote/build.mjs 的 emit），所以手机档赢；
 * dev 里 Vite 按模块图注入，theme-base 那两张表最后才落进 <head>，于是手机档
 * 反而输给主题 —— token 停在 13px/12px，代码块与 mermaid 的字号就不是手机档。
 * 元素级字号（body 15px 等）不受影响，只有 token 会被压住，所以现象很隐蔽。
 *
 * 只动 dev 注入的那张 <style>（带 data-vite-dev-id），不碰任何产品 CSS；
 * 非 dev（build 产物）里找不到这个标签，函数直接返回。
 */
function hoistRemotePageSheet() {
  const tag = document.querySelector<HTMLStyleElement>(
    'style[data-vite-dev-id$="/styles/remote-page.css"]',
  );
  if (!tag || tag.parentElement?.lastElementChild === tag) return;
  document.head.appendChild(tag);
}

/**
 * `waveRemotePage` 只能经 defineProperty 写。
 *
 * 本地 mock 支撑文件 `mock/_shared/mockShared.ts` 在模块体里把同名属性定义成
 * **只读 getter**（它按用例名前缀自己推断远控页，那是工具条还没有宿主开关时的
 * 权宜做法）。只读 getter 上直接赋值会抛 TypeError，整个 AppShell 崩掉、页面白屏
 * —— 所以这里改成可写的数据属性：mock 那边的 `if (!descriptor.get)` 判断不会再
 * 命中，工具条成为唯一真相源（远控相关用例仍可用，只是改由下拉切）。
 */
function setRemotePageFlag(on: boolean) {
  Object.defineProperty(window, "waveRemotePage", {
    value: on,
    writable: true,
    configurable: true,
  });
}

/** 某个端可用的 mock 用例。
 *
 *  移动端与插件端同一份清单：远控页跑的就是插件端那一档（`data-host="editor"`，
 *  同一份 chat.css 基线），只多一层 `remote-page.css` 手机档覆写；桌面端的用例
 *  在它上面渲染不出来（桌面态是 DesktopApp 那一侧消费的，且 `--cc-*` 语义 token
 *  只挂在 `[data-host="desktop"]` 上）。 */
const casesForHost = (host: PreviewHost) =>
  mockCases.filter(
    (c) => caseHostOf(getCase(c.key)) === (host === "remote" ? "editor" : host),
  );

// ── 应用外壳：activeKey 驱动用例，key 重挂载子树实现状态归零 ──────
const vscode = window.acquireVsCodeApi();

function AppShell() {
  const [activeKey, setActiveKey] = useState(initialSelection.key);
  // 这次选择的由来（兜底选中 / 上次的用例已失效 / 未找到可用用例）。首屏由
  // resolveInitialCase 决定，之后随用户的显式选择清空——工具条据此给出提示，
  // 免得到排查时把兜底选中的用例误当成用户自己选的。
  const [selection, setSelection] = useState<CaseSelection>(initialSelection);
  // 工具条手选的端（null = 跟用例走）。不持久化：刷新/新开页面回到用例自带的端，
  // 免得上次为了看一眼移动端而留下的选择，让下次打开时外壳莫名换了。
  // 一旦手选就钉住：之后在同一个端的用例清单里换用例，端不跟着用例变。
  const [hostOverride, setHostOverride] = useState<PreviewHost | null>(null);
  // 每个端各自记住上次看的用例（只在本页会话内）：端来回切时不会被打回第一条。
  // 首屏这一份要先记上——否则从桌面端切走再切回来，就落到清单第一条去了。
  const lastCaseByHost = useRef<Partial<Record<PreviewHost, string>>>(
    initialSelection.key
      ? { [caseHostOf(getCase(initialSelection.key))]: initialSelection.key }
      : {},
  );
  const activeCase = getCase(activeKey);
  const host = hostOverride ?? caseHostOf(activeCase);
  applyHost(host);

  const applyCase = (key: string, hostKey: PreviewHost) => {
    writeSession(CASE_STORAGE_KEY, key); // dev 记忆；沙箱静默降级
    mockWin.__waveMockResponders = getCase(key)?.responders || {}; // 预注册，先于新子树挂载
    lastCaseByHost.current[hostKey] = key;
    setActiveKey(key);
    setSelection({ key, fallback: false, staleSelection: false });
  };

  const selectCase = (key: string) => applyCase(key, host);

  // 换端：当前用例若不在新端的清单里，就补到该端上次看的 / 第一条。
  // 空串（「无 mock」）与新端的清单永远兼容——那个选项一直在。
  const selectHost = (next: PreviewHost) => {
    setHostOverride(next);
    const list = casesForHost(next);
    if (!activeKey || list.some((c) => c.key === activeKey)) return;
    applyCase(lastCaseByHost.current[next] ?? list[0]?.key ?? "", next);
  };

  // host 在依赖里：换端会重挂载子树（外壳不同），旧子树收到的对话流不会跟过去，
  // 必须按同一份用例脚本重放一遍。
  useEffect(() => {
    mockWin.__waveMockCancelPending(); // 取消旧用例未触发的延时消息（防串台）
    mockWin.__waveMockResponders = activeCase?.responders || {}; // 幂等兜底（「无 mock」清空）
    if (!activeCase) return; // 「无 mock」：不重放消息
    const fire = () => {
      (activeCase.messages || []).forEach((m) =>
        mockWin.__waveMockSendAfter(m.delay || 0, m.message),
      );
    };
    if (mockWin.__waveMockReady) fire();
    else mockWin.__waveMockReadyCallbacks.push(fire);
    return () => {
      const i = mockWin.__waveMockReadyCallbacks.indexOf(fire);
      if (i >= 0) mockWin.__waveMockReadyCallbacks.splice(i, 1);
      mockWin.__waveMockCancelPending();
    };
  }, [activeKey, activeCase, host]);

  return (
    <>
      <PreviewBoundary key={`${activeKey}|${host}`}>
        {/* 一个用例都没加载到（mock/ 目录空）时给一个带说明的空态：留在应用外壳
            里就是「没有任何宿主消息」的空白页，深色主题下看起来就是黑屏。 */}
        {mockKeys.length === 0 ? (
          <NoCaseNotice />
        ) : host === "desktop" ? (
          <DesktopApp vscode={vscode} />
        ) : (
          <ChatApp vscode={vscode} />
        )}
      </PreviewBoundary>
      <PreviewBar
        activeKey={activeKey}
        cases={casesForHost(host)}
        selection={selection}
        onSelectCase={selectCase}
        host={host}
        onSelectHost={selectHost}
      />
    </>
  );
}

// ── 预览工具条（用例切换 / 宿主切换 / 主题切换 / 拖拽移动）────────────
const BAR_POS_KEY = "wave-preview-bar-pos";

/** 用例下拉固定宽度（设计要求 280）：用例名长短差很多，让它自己撑会把工具条顶宽。 */
const CASE_SELECT_WIDTH = 280;

function PreviewBar({
  activeKey,
  cases,
  selection,
  onSelectCase,
  host,
  onSelectHost,
}: {
  activeKey: string;
  cases: ReadonlyArray<{ key: string; name: string }>;
  selection: CaseSelection;
  onSelectCase: (key: string) => void;
  host: PreviewHost;
  onSelectHost: (host: PreviewHost) => void;
}) {
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute("data-theme") === "light"
      ? "light"
      : "dark",
  );
  // 远控页的手机密度档挂在 `@media (pointer: coarse), (hover: none)` 上（见
  // remote-page.css 头注释），鼠标操作的桌面浏览器不命中 ⇒ 字号停在插件端那一档。
  // 只在「选了移动端但媒体查询没命中」时提示，免得把 13px 当成手机档去验。
  // 每次渲染现读（matchMedia 很轻），免得 DevTools 切换设备模拟后要刷新页面才更新。
  const phoneDensityAvailable =
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none)").matches;
  const barRef = useRef<HTMLDivElement>(null);
  // 拖拽位置（null = 默认右上角），拖完持久化到 sessionStorage（沙箱降级）。
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    const saved = readSession(BAR_POS_KEY);
    if (!saved) return null;
    try {
      return JSON.parse(saved) as { x: number; y: number };
    } catch {
      return null;
    }
  });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const clampPos = (x: number, y: number) => {
    const w = barRef.current?.offsetWidth ?? 300;
    const h = barRef.current?.offsetHeight ?? 40;
    return {
      x: Math.min(Math.max(0, x), window.innerWidth - w),
      y: Math.min(Math.max(0, y), window.innerHeight - h),
    };
  };

  const onDragStart = (e: React.PointerEvent) => {
    const rect = barRef.current!.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos?.x ?? rect.left,
      origY: pos?.y ?? rect.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPos(
      clampPos(
        d.origX + (e.clientX - d.startX),
        d.origY + (e.clientY - d.startY),
      ),
    );
  };

  const onDragEnd = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setPos((p) => {
      if (p) writeSession(BAR_POS_KEY, JSON.stringify(p));
      return p;
    });
  };

  const switchTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
  };

  return (
    <div
      ref={barRef}
      className="pv-bar"
      // 外观全在 preview-bar.css（需要伪类与 color-scheme）；这里只留拖拽位置。
      style={
        pos ? { left: pos.x, top: pos.y, right: "auto" } : { top: 8, right: 8 }
      }
    >
      <span
        role="button"
        aria-label="拖动移动工具条"
        title="拖动移动"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        className="pv-grip"
      >
        <i className="codicon codicon-gripper" />
      </span>
      <span className="pv-select">
        <select
          aria-label="宿主"
          title="先选端：桌面端 / 插件端 / 移动端（远控 Web 页）。右边只列这个端的 mock 用例"
          value={host}
          onChange={(e) => onSelectHost(e.target.value as PreviewHost)}
          className="pv-control"
        >
          {HOST_OPTIONS.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
      </span>
      <span className="pv-select">
        <select
          aria-label="mock 用例"
          title={cases.find((c) => c.key === activeKey)?.name ?? "无 mock"}
          value={activeKey}
          onChange={(e) => onSelectCase(e.target.value)}
          className="pv-control"
          style={{ width: CASE_SELECT_WIDTH }}
        >
          <option value="">— 无 mock（宿主无消息）—</option>
          {cases.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </span>
      {host === "remote" && !phoneDensityAvailable && (
        <span
          className="pv-hint"
          title="远控页的手机字号档由 @media (pointer: coarse), (hover: none) 触发，鼠标操作的桌面浏览器不会命中，现在看到的是插件端那一档字号。用浏览器 DevTools 的设备模拟（切到手机档）才看得到真实档位。"
        >
          <i className="codicon codicon-warning pv-hint-icon" />
          手机档需设备模拟
        </span>
      )}
      <SelectionBadges selection={selection} />
      <button
        type="button"
        onClick={switchTheme}
        title="切换深色/浅色主题"
        className="pv-control pv-control--action"
      >
        {theme === "dark" ? "深色" : "浅色"}
      </button>
    </div>
  );
}

// ── 渲染（与 src/index.tsx 相同分支逻辑；宿主由用例声明 + 工具条覆盖）──
const root = createRoot(document.getElementById("root")!);
root.render(<AppShell />);
