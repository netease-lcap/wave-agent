/**
 * Cross-host dark theme detection.
 * - VS Code webview: the host sets vscode-dark / vscode-light / vscode-high-contrast(-light)
 *   classes on <body>.
 * - Desktop / JetBrains: <html data-theme="dark|light"> (desktop preload; JB injects it in
 *   WebviewContentBuilder).
 */
export const isDarkTheme = (): boolean => {
    const bodyClass = document.body?.classList;
    if (bodyClass?.contains('vscode-dark') || bodyClass?.contains('vscode-high-contrast')) {
        return true;
    }
    if (bodyClass?.contains('vscode-light') || bodyClass?.contains('vscode-high-contrast-light')) {
        return false;
    }
    return document.documentElement.getAttribute('data-theme') === 'dark';
};
