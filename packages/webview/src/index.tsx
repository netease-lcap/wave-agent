import React from "react";
import ReactDOM from "react-dom/client";
import { ChatApp } from "./components/ChatApp";
import { DesktopApp } from "./components/DesktopApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/globals.css";
import "./styles/host-desktop.css";
import "./styles/remote-page.css";
import "./styles/plugin-controls.css";
import "@vscode/codicons/dist/codicon.css";

// window.acquireVsCodeApi / window.waveHostType are declared in types/index.ts.
const vscode = window.acquireVsCodeApi();

// data-host 驱动 host-desktop.css 的桌面端中密度参数（同一套 --vscode-* token、
// 两套取值：插件高密度 / 桌面端中密度）。desktop 真机的 index.html 也静态声明。
// 取值是 "plugin"，不是 "ide"：产品本身叫 CodeWave IDE，用 ide 指代「VS Code /
// JetBrains 插件端」会和桌面端混起来。远控 Web 页也落在 plugin 这一档（它没有
// 宿主类型、只多一个 data-remote-page，见 remote/shim.js）。
document.documentElement.dataset.host =
  window.waveHostType === "desktop" ? "desktop" : "plugin";

// 滚动条三态（Figma 5809:55691 / codechat main.ts 同款委托）：默认 8% 最浅、
// 鼠标在滚动区域内 24%、鼠标在轨道上/操作滚动条 50% 最深。Chrome 不响应
// scrollbar 伪元素的 :hover，改由 mousemove 委托在滚动容器上设 inline
// --cc-fill-scrollbar-active，host-desktop.css 的 thumb 引用该变量实时重绘。
if (window.waveHostType === "desktop") {
  let lastScrollEl: HTMLElement | null = null;
  document.addEventListener("mousemove", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.closest) return;
    let el: HTMLElement | null = target;
    while (el && el !== document.documentElement) {
      const s = getComputedStyle(el);
      const canV =
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight;
      const canH =
        (s.overflowX === "auto" || s.overflowX === "scroll") &&
        el.scrollWidth > el.clientWidth;
      if (canV || canH) break;
      el = el.parentElement;
    }
    if (!el) {
      lastScrollEl?.style.removeProperty("--cc-fill-scrollbar-active");
      lastScrollEl = null;
      return;
    }
    if (el !== lastScrollEl) {
      lastScrollEl?.style.removeProperty("--cc-fill-scrollbar-active");
      lastScrollEl = el;
    }
    const r = el.getBoundingClientRect();
    const overTrack =
      (e.clientX >= r.right - 20 && el.scrollHeight > el.clientHeight) ||
      (e.clientY >= r.bottom - 20 && el.scrollWidth > el.clientWidth);
    el.style.setProperty(
      "--cc-fill-scrollbar-active",
      overTrack
        ? "var(--cc-fill-scrollbar-hover)"
        : "var(--cc-fill-scrollbar-container-hover)",
    );
  });
}

// Create root and render React app
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  // 边界包在根上、四个宿主共用：任何一处渲染期抛错，原本都会卸载整棵树变成
  // 纯白页，用户除了重启客户端没有别的动作。
  <ErrorBoundary>
    {window.waveHostType === "desktop" ? (
      <DesktopApp vscode={vscode} />
    ) : (
      <ChatApp vscode={vscode} />
    )}
  </ErrorBoundary>,
);
