/**
 * Desktop-only code editor chunk entry. Built as a separate IIFE bundle
 * (dist/editor.js, global `window.WaveEditor`) and lazy-injected by the file
 * panel only on the desktop host — VSCE/JetBrains sync targets filter it out,
 * so CodeMirror never ships in plugin artifacts (same shape as the terminal
 * chunk next to it).
 */
export { createCodeEditor } from "./components/fileEditor/createCodeEditor";
export type {
  CodeEditorHandle,
  CodeEditorOptions,
} from "./components/fileEditor/createCodeEditor";
