/**
 * 聊天区的纯显示偏好。
 *
 * 与侧边栏折叠（`DesktopChromeContext`）、Artifacts 视图模式同档：按端存
 * localStorage，不落 settings.json、不进会话、不参与提示词，因此没有配置面
 * 那圈白名单要同步（对照 `focusView` 一旦要进 settings 就得改十来个宿主文件）。
 *
 * **入口在设置页，不在聊天界面**（2026-11-27 用户拍板）：开关挪到「全局设置 ›
 * 聊天显示」后，设置页与聊天视图可能是两块不同的渲染面 —— 插件端是同一个
 * webview 内的页面切换，桌面端设置是独立窗口 —— 所以写完要能通知到已挂载的
 * 那个视图：同页面靠 listeners，跨窗口靠 storage 事件。
 */
const FOCUS_VIEW_KEY = "wave.chat.focusView";

const focusViewListeners = new Set<(value: boolean) => void>();

export function readFocusViewPreference(): boolean {
  try {
    return window.localStorage.getItem(FOCUS_VIEW_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeFocusViewPreference(value: boolean): void {
  try {
    if (value) {
      window.localStorage.setItem(FOCUS_VIEW_KEY, "1");
    } else {
      window.localStorage.removeItem(FOCUS_VIEW_KEY);
    }
  } catch {
    // 隐私模式 / 配额满：偏好退化成「只在本次页面有效」，功能本身不受影响。
  }
  // 同一页面写 localStorage 不会触发自己的 storage 事件（规范如此），所以这里
  // 手动通知本页的订阅者；跨窗口那一份由下面的 storage 监听补齐。
  focusViewListeners.forEach((listener) => listener(value));
}

/**
 * 订阅聚焦视图偏好。返回取消订阅。
 *
 * 只订阅`这一颗 key`：`clear()` 之类的写入 key 为 null，也要当作可能的变化处理
 * （清空后 `readFocusViewPreference` 自然回到 false，不需要额外判断）。
 */
export function subscribeFocusViewPreference(
  listener: (value: boolean) => void,
): () => void {
  focusViewListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== FOCUS_VIEW_KEY) return;
    listener(readFocusViewPreference());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    focusViewListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
