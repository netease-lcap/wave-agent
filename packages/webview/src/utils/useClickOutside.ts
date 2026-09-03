import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export interface UseClickOutsideOptions {
  /**
   * 豁免节点：mousedown 落在任一节点内部（或就是节点本身）不算"外部"。
   * 通常传弹层根 ref；若点击触发按钮也需要豁免（例如再点一次按钮 toggle
   * 关闭），把按钮 ref 一并传入。
   */
  refs: Array<RefObject<HTMLElement | null>>;
  /** 点击所有豁免节点之外时触发。 */
  onClickOutside: (event: MouseEvent) => void;
  /** false 时不注册监听（默认 true）。 */
  enabled?: boolean;
}

/**
 * 监听 document 上的 mousedown，实现"点击弹层外部关闭"。
 *
 * 监听器延迟一帧（setTimeout 0）再注册：当弹层由同一次 mousedown 触发挂载
 * 时（例如鼠标点击快捷指令列表项打开 /rewind、/model 弹层），那次 mousedown
 * 仍在冒泡到 document。若挂载 effect 同步注册监听器，事件会命中它而 target
 * 又在弹层之外，弹层便会被自己的打开点击立即关闭——键盘选中回车没有 mousedown
 * 所以正常。延迟注册让打开弹层的那次点击先冒泡结束。这是 DOM 事件机制下的
 * 标准解法，与 Radix DismissableLayer 的处理一致。
 */
export function useClickOutside({
  refs,
  onClickOutside,
  enabled = true,
}: UseClickOutsideOptions): void {
  // 最新值经 ref 读取：调用方每次渲染传入的 refs 数组与 onClickOutside 都是
  // 新引用，若直接进 effect 依赖会导致监听器每次渲染后重建（并重新延迟注册）。
  const latest = useRef({ refs, onClickOutside });
  latest.current = { refs, onClickOutside };

  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const { refs: currentRefs, onClickOutside: handleOutside } =
        latest.current;
      const isInside = currentRefs.some(
        (ref) => !!ref.current && ref.current.contains(target),
      );
      if (!isInside) handleOutside(event);
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [enabled]);
}
