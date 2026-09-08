import { useEffect, useRef } from "react";

/** host→webview 消息负载（window "message" 事件的 event.data）。 */
type HostMessage = MessageEvent["data"];

export interface UseHostMessageOptions {
  /**
   * 分屏 pane 路由（DiffPane 语义）：设置后仅放行 `message.paneId === paneId`
   * 的消息（未打标签的消息会被丢弃）；不设置（undefined）时不过滤。
   *
   * 注意这只覆盖「pane 实例只收自己的标签」这一种语义。以下站点的过滤语义
   * 不同，保持各自内联处理，不得改用本选项：
   * - ChatApp 根实例：未打标签的窗口级消息 + pane rows 隐藏期间代收标签消息
   *   （forThisPane，见 ChatApp.tsx 内注释）。
   * - TerminalPane：按 termId（`term-${paneId}` 派生身份）过滤，不是
   *   message.paneId。
   * - FilePane / MessageInput / DesktopWorkdirSelector：按 requestId 做
   *   请求关联过滤；MessageInput 仅 uploadSuccess 单条命令按 paneId 过滤
   *   （全局过滤会误杀 pane 实例要收的未打标签消息）。
   */
  paneId?: string;
  /** false 时事件直接忽略、不进入 handler（默认 true）。 */
  enabled?: boolean;
}

/**
 * 订阅 host → webview 的 window "message" 通道。
 *
 * useClickOutside 同款先例模式：监听器只在挂载时注册一次、卸载时移除；每次
 * 渲染传入的 onMessage 与 options 都是（可能）新引用，经 latest ref 在事件
 * 到达时读取最新值——调用方无需把它们排进依赖数组，也不会出现「闭包冻结在
 * 首帧」或「随渲染反复移除重挂监听器」。语义上等价于旧的「依赖数组变化时
 * 重挂 + 新闭包」写法：消息永远由最新注册的处理逻辑消费。
 *
 * handler 收到的是 event.data（host 消息负载），命令分发（switch/if）由
 * 调用方自理——各组件监听的命令集合与过滤条件差异较大，不在 hook 里建模。
 */
export function useHostMessage(
  onMessage: (message: HostMessage) => void,
  options: UseHostMessageOptions = {},
): void {
  // 最新值经 ref 读取：调用方每次渲染传入的 onMessage 与 options 都是新引用，
  // 若直接进 effect 依赖会导致监听器每次渲染后重建。
  const latest = useRef({ onMessage, options });
  latest.current = { onMessage, options };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { onMessage: handle, options: current } = latest.current;
      if (current.enabled === false) return;
      // 分屏 pane 路由：pane 实例只消费打了自己标签的消息（DiffPane 语义）。
      const { paneId } = current;
      if (paneId !== undefined && event.data?.paneId !== paneId) return;
      handle(event.data);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
}
