import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatApp } from './components/ChatApp';
import './styles/globals.css';
import '@vscode/codicons/dist/codicon.css';

// Initialize VS Code API
declare global {
  interface Window {
    acquireVsCodeApi(): { postMessage: (msg: unknown) => void; getState: () => unknown; setState: (state: unknown) => void };
  }
}

const vscode = window.acquireVsCodeApi();

// Create root and render React app
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<ChatApp vscode={vscode} />);