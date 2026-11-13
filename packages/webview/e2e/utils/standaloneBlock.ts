/**
 * `@media (display-mode: standalone) { … }` 的块内容，从产物 CSS 里原样取出来。
 *
 * 装机形态（主屏启动的 Web App）是远控页顶部那套规则的唯一生效条件，而 headless
 * 浏览器**进不了**它：没有清单、没有浏览器 UI，`display-mode` 永远是 `browser`。
 * 所以 e2e 反过来做——把这层媒体条件去掉、把里面的声明原样注入回去，量到的仍是
 * 已发布的那些声明，而不是测试里另写的一份。
 */
export const standaloneBlock = (css: string) => {
  const open = css.search(/@media\s*\(\s*display-mode:\s*standalone\s*\)\s*\{/);
  if (open < 0) return "";
  const from = css.indexOf("{", open);
  let depth = 0;
  for (let i = from; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(from + 1, i);
  }
  return "";
};
