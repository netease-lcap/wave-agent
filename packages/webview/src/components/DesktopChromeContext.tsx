import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * 窗口级（chrome）UI 状态单一权威 —— 解决「root 单布局 与 DesktopShell pane
 * 渲染路径共享窗口级状态却各自维护/漏下行」的一类 bug（spec「macOS 隐藏标题
 * 栏」场景 3/7、「侧边栏收起/展开」场景 7）：
 * - sidebarCollapsed：侧边栏整条收起/展开，localStorage 持久化（原 root
 *   ChatApp 私有 state——pane 实例只拿到挂载时快照、运行期收起会过期）。
 * - fullScreen：macOS 系统全屏（desktopFullScreen host push，原各 ChatApp
 *   实例各自 setState——DesktopShell 渲染的侧边栏收不到）。
 *
 * Provider 挂在 DesktopApp（窗口根），root/pane 任何 ChatApp 实例及其子树
 * （DesktopShell/DesktopSidebar/ChatHeader）都从 Context 同源读取，不再存在
 * 两条渲染路径、两份副本。IDE（VSCE/JetBrains）不渲染 Provider → 读默认值
 * （false），不影响其现有行为。
 */
export interface DesktopChromeValue {
  /** 侧边栏整条收起（true）= 对话占满全宽，最左顶栏显示展开按钮。 */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** macOS 全屏（系统红绿灯隐藏，红绿灯让位收起）。非 macOS 恒 false。 */
  fullScreen: boolean;
}

const DesktopChromeContext = createContext<DesktopChromeValue>({
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
  fullScreen: false,
});

const SIDEBAR_COLLAPSED_KEY = "wave.desktopSidebarCollapsed";

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
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.command === "desktopFullScreen") {
        setFullScreen(event.data.fullScreen === true);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // localStorage unavailable (sandboxed webview): the collapse still works
      // for this session, it just won't persist.
    }
  }, []);

  const value = useMemo<DesktopChromeValue>(
    () => ({ sidebarCollapsed, setSidebarCollapsed, fullScreen }),
    [sidebarCollapsed, setSidebarCollapsed, fullScreen],
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
