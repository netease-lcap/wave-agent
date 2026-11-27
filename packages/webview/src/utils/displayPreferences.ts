/**
 * 聊天区的纯显示偏好。
 *
 * 与侧边栏折叠（`DesktopChromeContext`）、Artifacts 视图模式同档：按端存
 * localStorage，不落 settings.json、不进会话、不参与提示词，因此没有配置面
 * 那圈白名单要同步（对照 `focusView` 一旦要进 settings 就得改十来个宿主文件）。
 */
const FOCUS_VIEW_KEY = "wave.chat.focusView";

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
}
