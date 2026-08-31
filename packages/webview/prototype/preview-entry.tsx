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
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatApp } from "../src/components/ChatApp";
import { DesktopApp } from "../src/components/DesktopApp";
import "../src/styles/globals.css";
import "@vscode/codicons/dist/codicon.css";
import "../theme/theme-base-light.css";
import "../theme/theme-base-dark.css";
import type { MockCase, MockHelpers } from "./types";

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
// 默认加载「桌面端：全功能」用例，避免打开原型预览看到无限扫光 loading
// （ChatApp 无任何宿主消息时停留在 showWelcome）。dev 下记住上次选择；
// 若存储的用例文件已不存在（mock/ 是 gitignore 的本地目录），回退到默认。
const getCase = (key: string) =>
  key ? mockModules[`./mock/${key}.ts`]?.default : undefined;
const mockKeys = Object.keys(mockModules);
const defaultKey = mockKeys.includes("./mock/desktop-full.ts")
  ? "desktop-full"
  : (mockKeys[0]?.slice("./mock/".length, -3) ?? "");
const initialKey = (() => {
  const candidate = readSession("wave-preview-case");
  return candidate !== null && mockModules[`./mock/${candidate}.ts`]
    ? candidate
    : defaultKey;
})();
mockWin.__waveMockResponders = getCase(initialKey)?.responders || {};

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

// ── 应用外壳：activeKey 驱动用例，key 重挂载子树实现状态归零 ──────
const vscode = window.acquireVsCodeApi();

function AppShell() {
  const [activeKey, setActiveKey] = useState(initialKey);
  const activeCase = getCase(activeKey);

  const selectCase = (key: string) => {
    writeSession("wave-preview-case", key); // dev 记忆；沙箱静默降级
    mockWin.__waveMockResponders = getCase(key)?.responders || {}; // 预注册，先于新子树挂载
    setActiveKey(key);
  };

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
  }, [activeKey, activeCase]);

  const host =
    activeCase?.host === "desktop" || window.waveHostType === "desktop"
      ? "desktop"
      : "ide";
  return (
    <>
      <PreviewBoundary key={activeKey}>
        {host === "desktop" ? (
          <DesktopApp vscode={vscode} />
        ) : (
          <ChatApp vscode={vscode} />
        )}
      </PreviewBoundary>
      <PreviewBar activeKey={activeKey} onSelectCase={selectCase} />
    </>
  );
}

// ── 预览工具条（用例切换 / 主题切换 / 拖拽移动）──────────────────────
const BAR_POS_KEY = "wave-preview-bar-pos";

function PreviewBar({
  activeKey,
  onSelectCase,
}: {
  activeKey: string;
  onSelectCase: (key: string) => void;
}) {
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute("data-theme") === "light"
      ? "light"
      : "dark",
  );
  const cases = useMemo(() => mockCases, []);
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
      style={{
        position: "fixed",
        ...(pos
          ? { left: pos.x, top: pos.y, right: "auto" }
          : { top: 8, right: 8 }),
        zIndex: 100000,
        display: "flex",
        gap: 6,
        alignItems: "center",
        background: "var(--vscode-editor-background, #1e1e1e)",
        border: "1px solid var(--vscode-widget-border, #555)",
        borderRadius: 6,
        padding: "6px 8px",
        fontSize: 12,
        boxShadow: "0 2px 8px rgba(0,0,0,.35)",
        maxWidth: "40vw",
        cursor: "default",
      }}
    >
      <span
        role="button"
        aria-label="拖动移动工具条"
        title="拖动移动"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        style={{
          cursor: "grab",
          color: "var(--vscode-descriptionForeground, #888)",
          userSelect: "none",
          touchAction: "none",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        <i className="codicon codicon-gripper" />
      </span>
      <select
        aria-label="mock 用例"
        value={activeKey}
        onChange={(e) => onSelectCase(e.target.value)}
        style={{
          font: "inherit",
          border: "1px solid var(--vscode-widget-border, #555)",
          borderRadius: 4,
          background: "var(--vscode-input-background, #333)",
          color: "inherit",
          padding: "2px 6px",
        }}
      >
        <option value="">— 无 mock（宿主无消息）—</option>
        {cases.map((c) => (
          <option key={c.key} value={c.key}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={switchTheme}
        title="切换深色/浅色主题"
        style={{
          font: "inherit",
          border: "1px solid var(--vscode-widget-border, #555)",
          borderRadius: 4,
          background: "var(--vscode-input-background, #333)",
          color: "inherit",
          padding: "2px 6px",
        }}
      >
        {theme === "dark" ? "深色" : "浅色"}
      </button>
    </div>
  );
}

// ── 渲染（与 src/index.tsx 相同分支逻辑；mock 用例可声明 host 覆盖）──
const root = createRoot(document.getElementById("root")!);
root.render(<AppShell />);
