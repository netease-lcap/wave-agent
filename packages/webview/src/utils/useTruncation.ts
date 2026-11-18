import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 菜单里「哪些行被省略了」的测量。
 *
 * 口径来自 0917 排队消息那条评论「字数少就不应该有气泡」：逐条比
 * `scrollWidth > clientWidth + 1`，只把真正被省略的行报出来 —— 按字数猜会在
 * 中英混排 / `-` `/` 宽度不同的名字上判错。
 *
 * 三个工作目录菜单（分支、主机、最近打开）共用这一份：它们在同一个灰条上、
 * 宽度同档（host-desktop.css 里钉死），被省略时也都用同一颗自绘气泡补全文。
 *
 * - `open`：菜单只在自己展开时才有节点可量，收起就清空结果。
 * - `signature`：条目集合的指纹（名字用 `\n` 拼），换数据时重量一次。
 * - `register(key)`：给被量的节点挂 ref；`key` 由调用方定，`truncated` 里就是它。
 */
export function useTruncation(open: boolean, signature: string) {
  const refs = useRef(new Map<string, HTMLElement>());
  const [truncated, setTruncated] = useState<string[]>([]);

  const register = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) refs.current.set(key, el);
      else refs.current.delete(key);
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      setTruncated((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const measure = () => {
      const next: string[] = [];
      refs.current.forEach((el, key) => {
        if (el.scrollWidth > el.clientWidth + 1) next.push(key);
      });
      setTruncated((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i])
          ? prev
          : next,
      );
    };
    // 菜单刚挂载的同一帧还量不到宽度，下一帧再量；之后宽度变化由 RO 兜住
    // （窗口缩放、侧栏开合都会改变可用的名称宽度）。
    const raf = requestAnimationFrame(measure);
    if (typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(raf);
    }
    const ro = new ResizeObserver(measure);
    refs.current.forEach((el) => ro.observe(el));
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [open, signature]);

  return { register, truncated };
}
