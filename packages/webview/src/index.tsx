import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatApp } from './components/ChatApp';
import { DesktopApp } from './components/DesktopApp';
import './styles/globals.css';
import '@vscode/codicons/dist/codicon.css';

// Initialize VS Code API
declare global {
  interface Window {
    acquireVsCodeApi(): { postMessage: (msg: unknown) => void; getState: () => unknown; setState: (state: unknown) => void };
    // Set by the Electron preload script (packages/desktop) to select the
    // desktop root component. Undefined inside VS Code / JetBrains hosts.
    waveHostType?: string;
  }
}

const vscode = window.acquireVsCodeApi();

// Create root and render React app
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  window.waveHostType === 'desktop'
    ? <DesktopApp vscode={vscode} />
    : <ChatApp vscode={vscode} />
);
