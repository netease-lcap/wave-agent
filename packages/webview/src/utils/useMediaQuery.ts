import { useEffect, useState } from "react";

/**
 * 一条 CSS 媒体查询的布尔值（spec `ecosystem/plugin-mods.md`「在 IDE 插件里画」：
 * mod 面板按聊天面板宽度挑 dock / inline，断点就是 `(min-width: 800px)`，与
 * Claude Code 同一个数）。
 *
 * 不用 `resize` 事件自己算宽度：查的是同一条媒体查询，断点只写一次；也顺带拿到
 * `matchMedia` 的变化回调，用户拖宽窄面板时立刻跟着换布局。
 *
 * 没有 `matchMedia` 的环境（jsdom 的某些假 window）按「宽」处理 —— 与 Tooltip 里
 * 「没有能力信息时保持既有行为」同一条纪律：dock 是常规布局，猜窄会让面板凭空
 * 挤进输入框上方。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return true;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setMatches(mql.matches);
    // 先对齐一次：首帧到 effect 之间窗口可能已经变了。
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
