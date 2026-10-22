/**
 * Loader for the desktop-only `editor.js` chunk (CodeMirror). Same shape as the
 * terminal chunk's loader: a same-origin <script> tag, a single in-flight
 * promise, and a cached global. Desktop only — the chunk is filtered out of the
 * IDE hosts' webview directory, so `window.WaveEditor` never appears there and
 * the file panel simply has no edit affordance.
 */

export interface CodeEditorHandle {
  getValue(): string;
  focus(): void;
  destroy(): void;
}

export interface CodeEditorOptions {
  doc: string;
  path: string;
  dark: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
}

export interface WaveEditorGlobal {
  createCodeEditor(
    parent: HTMLElement,
    options: CodeEditorOptions,
  ): CodeEditorHandle;
}

declare global {
  interface Window {
    /** Set by the lazily injected desktop-only editor chunk (editor.js). */
    WaveEditor?: WaveEditorGlobal;
  }
}

let editorLibPromise: Promise<WaveEditorGlobal> | null = null;

export function loadEditorLib(): Promise<WaveEditorGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("editor chunk 需要浏览器环境"));
  }
  if (window.WaveEditor) return Promise.resolve(window.WaveEditor);
  if (editorLibPromise) return editorLibPromise;
  editorLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./editor.js";
    script.onload = () => {
      if (window.WaveEditor) resolve(window.WaveEditor);
      else reject(new Error("editor chunk 未导出 WaveEditor"));
    };
    script.onerror = () => reject(new Error("editor.js 加载失败"));
    document.head.appendChild(script);
  });
  // Allow a later retry after a failed load.
  editorLibPromise.catch(() => {
    editorLibPromise = null;
  });
  return editorLibPromise;
}
