import { useEffect, useRef, useState } from "react";
import { useHostMessage } from "./useHostMessage";

type HostMessage = MessageEvent["data"];

export interface UseSettingsListOptions<TList> {
  /** 列表状态初始值（与视图原 useState 初值一致：数组视图传 []，钩子视图传 {}）。 */
  initialItems: TList;
  /** 发送拉取请求（闭包 vscode；vscode 缺省时可选链自然不发）。经 latest ref
   *  读取，调用方无需 useCallback，也无需担心闭包过期。 */
  fetchRequest: () => void;
  /** 变化时重新置 loading 并重新拉取（钩子视图传 activeTab；缺省仅挂载拉取一次）。 */
  fetchKey?: string;
  /** 命中即消费的响应命令（一到多条，如 mcpServersResponse + mcpServersUpdate）。 */
  responseCommands: string[];
  /** 从响应消息提取列表状态（含 || [] / || {} 兜底）。 */
  pickItems: (message: HostMessage) => TList;
  /**
   * 响应归属键提取（过期即弃，webview-fixtures ReplyAttribution 契约）：
   * 提取值 ≠ fetchKey 的回复直接丢弃（切 Tab 前发出的慢回复不得覆盖当前
   * Tab 的列表）。钩子视图传 `(message) => message.scope`；fetchKey 缺省
   * （挂载拉取一次的视图）不传本项即无归属过滤。
   */
  attributionKey?: (message: HostMessage) => string;
  /** 命中响应后的附加视图状态更新（钩子 configPath / MCP connecting 清零）。 */
  onResponse?: (message: HostMessage) => void;
}

/**
 * 设置页「列表视图」共用状态机（host_route_audit P2-A 收敛）：
 * 挂载/fetchKey 变化 → 置 loading + 发拉取请求（fetchKey 变化时同时收起未
 * 确认的删除框，即切来源 Tab）→ Response 到达 → 写列表 + onResponse +
 * 解除 loading；外加「删除二次确认」pendingDelete 状态。
 * Skills / Subagents / Hooks / Mcp 四视图的相同骨架收敛于此；真正删除动作
 * 由视图在 confirmDelete(send) 的 send 回调里闭包（乐观更新 or 重新拉取
 * 各视图不同）。refresh() 仅重发拉取请求、不动 loading（对齐删除后重新
 * 拉取时加载占位不闪现的原行为）。
 */
export function useSettingsList<TList, TItem>(
  options: UseSettingsListOptions<TList>,
) {
  const [items, setItems] = useState<TList>(options.initialItems);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<TItem | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const { fetchKey } = options;

  useEffect(() => {
    // fetchKey 变化（切来源 Tab）时顺手收起未确认的删除框
    setPendingDelete(null);
    setLoading(true);
    latest.current.fetchRequest();
  }, [fetchKey]);

  useHostMessage((message) => {
    const current = latest.current;
    if (!current.responseCommands.includes(message.command)) return;
    // 过期即弃：归属键与当前 fetchKey 不一致的回复（切 Tab 前发出的慢回复）
    // 直接丢弃——不写列表、不解 loading（当前 Tab 的拉取仍在途）。
    if (current.attributionKey && current.fetchKey !== undefined) {
      if (current.attributionKey(message) !== current.fetchKey) return;
    }
    setItems(current.pickItems(message));
    current.onResponse?.(message);
    setLoading(false);
  });

  const refresh = () => latest.current.fetchRequest();
  const cancelDelete = () => setPendingDelete(null);
  const confirmDelete = (send: (item: TItem) => void) => {
    const item = pendingDelete;
    if (!item) return;
    send(item);
    setPendingDelete(null);
  };

  return {
    items,
    setItems,
    loading,
    refresh,
    pendingDelete,
    setPendingDelete,
    cancelDelete,
    confirmDelete,
  };
}
