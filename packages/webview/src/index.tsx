import React from "react";
import ReactDOM from "react-dom/client";
import { ChatApp } from "./components/ChatApp";
import { DesktopApp } from "./components/DesktopApp";
import "./styles/globals.css";
import "@vscode/codicons/dist/codicon.css";

// window.acquireVsCodeApi / window.waveHostType are declared in types/index.ts.
const vscode = window.acquireVsCodeApi();

// Create root and render React app
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  window.waveHostType === "desktop" ? (
    <DesktopApp vscode={vscode} />
  ) : (
    <ChatApp vscode={vscode} />
  ),
);
