import React from "react";
import ReactDOM from "react-dom/client";
import { ChatApp } from "./components/ChatApp";
import { DesktopApp } from "./components/DesktopApp";
import "./styles/globals.css";
import "./styles/host-desktop.css";
import "@vscode/codicons/dist/codicon.css";

// window.acquireVsCodeApi / window.waveHostType are declared in types/index.ts.
const vscode = window.acquireVsCodeApi();

// data-host 驱动 host-desktop.css 的桌面端中密度参数（同一套 --vscode-* token、
// 两套取值：插件高密度 / 桌面端中密度）。desktop 真机的 index.html 也静态声明。
document.documentElement.dataset.host =
  window.waveHostType === "desktop" ? "desktop" : "ide";

// Create root and render React app
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  window.waveHostType === "desktop" ? (
    <DesktopApp vscode={vscode} />
  ) : (
    <ChatApp vscode={vscode} />
  ),
);
