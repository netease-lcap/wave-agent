/**
 * Desktop-only terminal chunk entry. Built as a separate IIFE bundle
 * (dist/terminal.js, global `window.WaveTerminal`) and lazy-injected by
 * TerminalPane only on the desktop host — VSCE/JetBrains sync targets filter
 * it out, so xterm never ships in plugin artifacts.
 */
import '@xterm/xterm/css/xterm.css';

export { Terminal } from '@xterm/xterm';
export { FitAddon } from '@xterm/addon-fit';
