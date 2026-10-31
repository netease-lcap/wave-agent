import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useHostMessage } from "../utils/useHostMessage";

/**
 * 窗口级（chrome）UI 状态单一权威 —— 解决「root 单布局 与 DesktopShell pane
 * 渲染路径共享窗口级状态却各自维护/漏下行」的一类 bug（spec「macOS 隐藏标题
 * 栏」场景 3/7、「侧边栏收起/展开」场景 7）：
 * - sidebarCollapsed：侧边栏整条收起/展开，localStorage 持久化（原 root
 *   ChatApp 私有 state——pane 实例只拿到挂载时快照、运行期收起会过期）。
 * - sidebarGroupCollapsed：侧边栏里每个目录分组的折叠状态（key =
 *   `host:workdir`），localStorage 持久化，重启后保持（spec
 *   docs/specs/desktop/desktop-sessions.md「侧栏分组折叠状态记忆」）。原先
 *   是 DesktopSidebar 内的 state：组件重挂载即丢，每次启动都全展开。
 * - fullScreen：macOS 系统全屏（desktopFullScreen host push，原各 ChatApp
 *   实例各自 setState——DesktopShell 渲染的侧边栏收不到）。
 *
 * Provider 挂在 DesktopApp（窗口根），root/pane 任何 ChatApp 实例及其子树
 * （DesktopShell/DesktopSidebar/ChatHeader）都从 Context 同源读取，不再存在
 * 两条渲染路径、两份副本。插件端不渲染 Provider → 读默认值
 * （false），不影响其现有行为。
 */
export interface DesktopChromeValue {
  /** 侧边栏整条收起（true）= 对话占满全宽，最左顶栏显示展开按钮。 */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** 侧边栏目录分组的折叠状态，key = `host:workdir`；缺项即展开。 */
  sidebarGroupCollapsed: Record<string, boolean>;
  setSidebarGroupCollapsed: (groupKey: string, collapsed: boolean) => void;
  /** macOS 全屏（系统红绿灯隐藏，红绿灯让位收起）。非 macOS 恒 false。 */
  fullScreen: boolean;
}

const DesktopChromeContext = createContext<DesktopChromeValue>({
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
  sidebarGroupCollapsed: {},
  setSidebarGroupCollapsed: () => {},
  fullScreen: false,
});

const SIDEBAR_COLLAPSED_KEY = "wave.desktopSidebarCollapsed";
const SIDEBAR_GROUP_COLLAPSED_KEY = "wave.desktopSidebarGroupCollapsed";

/** 读回分组折叠状态：只认布尔值，损坏/不可用一律退回「全部展开」。 */
const readGroupCollapsed = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(SIDEBAR_GROUP_COLLAPSED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const collapsed: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") collapsed[key] = value;
    }
    return collapsed;
  } catch {
    // localStorage unavailable / stored value not JSON: start fully expanded.
    return {};
  }
};

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    // localStorage unavailable (sandboxed webview): default to expanded.
    return false;
  }
};

export const DesktopChromeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [sidebarCollapsed, setSidebarCollapsedState] =
    useState<boolean>(readCollapsed);
  const [sidebarGroupCollapsed, setSidebarGroupCollapsedState] =
    useState<Record<string, boolean>>(readGroupCollapsed);
  const [fullScreen, setFullScreen] = useState(false);

  // 落盘走 effect 而非 setter：React 可能重复调用 updater，副作用留在那里会
  // 被写成两次；effect 只跟随已提交的状态，挂载时写回与读到的内容一致。
  useEffect(() => {
    try {
      localStorage.setItem(
        SIDEBAR_GROUP_COLLAPSED_KEY,
        JSON.stringify(sidebarGroupCollapsed),
      );
    } catch {
      // localStorage unavailable (sandboxed webview): 折叠照常生效，只是不持久化。
    }
  }, [sidebarGroupCollapsed]);

  useHostMessage((message) => {
    if (message?.command === "desktopFullScreen") {
      setFullScreen(message.fullScreen === true);
    }
  });

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // localStorage unavailable (sandboxed webview): the collapse still works
      // for this session, it just won't persist.
    }
  }, []);

  const setSidebarGroupCollapsed = useCallback(
    (groupKey: string, collapsed: boolean) => {
      setSidebarGroupCollapsedState((prev) =>
        (prev[groupKey] ?? false) === collapsed
          ? prev
          : { ...prev, [groupKey]: collapsed },
      );
    },
    [],
  );

  const value = useMemo<DesktopChromeValue>(
    () => ({
      sidebarCollapsed,
      setSidebarCollapsed,
      sidebarGroupCollapsed,
      setSidebarGroupCollapsed,
      fullScreen,
    }),
    [
      sidebarCollapsed,
      setSidebarCollapsed,
      sidebarGroupCollapsed,
      setSidebarGroupCollapsed,
      fullScreen,
    ],
  );

  return (
    <DesktopChromeContext.Provider value={value}>
      {children}
    </DesktopChromeContext.Provider>
  );
};

/** 读取窗口级 chrome 状态（无 Provider 的 IDE/测试场景回退默认 false）。 */
export const useDesktopChrome = (): DesktopChromeValue =>
  useContext(DesktopChromeContext);
