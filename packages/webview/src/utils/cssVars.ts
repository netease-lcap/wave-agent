/**
 * 读取 :root 上的 CSS 自定义属性并去掉首尾空白；取值为空时回退 fallback。
 * 主题变量（--vscode-* / --cc-*）随 <html data-theme> 切换，每次调用实时读取。
 */
export function readRootCssVar(name: string, fallback = ""): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}
