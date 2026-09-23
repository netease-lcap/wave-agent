import { useCallback, useRef } from "react";
import { useHostMessage } from "./useHostMessage";
import type {
  RenameSessionHandler,
  RenameSessionResult,
  VsCodeApi,
} from "../types";

interface PendingRename {
  requestId: string;
  sessionId: string;
  /** 失败回滚用的原标题（调用方按显示优先级算出的标题）。 */
  previousTitle: string;
  resolve: (result: RenameSessionResult) => void;
}

/**
 * 提交会话重命名（spec session-management.md「会话自定义标题（重命名）」/
 * desktop-sessions.md 同故事）。
 *
 * 统一实现「乐观更新 → 请求 → 按 requestId 关联回复 → 失败回滚」这条链，头部
 * 就地编辑（ChatApp）与桌面侧边栏行内编辑（DesktopApp）共用，避免两处各写一份
 * 请求关联逻辑（这一层最容易漏掉「旧回复即弃」而把标题改回旧值）。
 *
 * 乐观更新由调用方通过 `applyTitle` 落进自己的状态：webview 头部注入的是
 * reducer 的 RENAME_SESSION（sessions 列表 + currentSession），桌面注入的是
 * 会话树的本地覆盖（侧边栏行 + 看板卡片一起变）。失败时用同一入口写回原标题，
 * 回滚走的就是同一条路径。
 */
export function useSessionRename(
  vscode: VsCodeApi,
  applyTitle: (sessionId: string, title: string) => void,
): RenameSessionHandler {
  // 在途请求：只有匹配 requestId 的回复被消费（同一会话可反复改名，晚到的旧回复
  // 必须丢弃）。按 requestId 存（不是一个槽位）——侧边栏可以连续给不同会话改名，
  // 单个槽位会让先前那个请求永远等不到回复。
  const pendingRef = useRef(new Map<string, PendingRename>());

  useHostMessage((message) => {
    if (message.command !== "sessionRenamed") return;
    const requestId = String(message.requestId);
    const pending = pendingRef.current.get(requestId);
    if (!pending) return;
    if (message.sessionId !== pending.sessionId) return;
    pendingRef.current.delete(requestId);
    if (!message.ok) {
      // 失败：回滚已应用的乐观标题，并把错误交回调用方展示（不得静默回滚）。
      applyTitle(message.sessionId, pending.previousTitle);
    }
    pending.resolve({
      ok: message.ok === true,
      error: typeof message.error === "string" ? message.error : undefined,
    });
  });

  return useCallback(
    (
      sessionId: string,
      title: string,
      previousTitle: string,
    ): Promise<RenameSessionResult> => {
      const requestId = `rename-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      applyTitle(sessionId, title);
      const result = new Promise<RenameSessionResult>((resolve) => {
        pendingRef.current.set(requestId, {
          requestId,
          sessionId,
          previousTitle,
          resolve,
        });
      });
      vscode.postMessage({
        command: "renameSession",
        sessionId,
        title,
        requestId,
      });
      return result;
    },
    [vscode, applyTitle],
  );
}
