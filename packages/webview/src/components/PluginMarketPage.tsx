import React from "react";
import { SidebarExpandIcon } from "./HeaderIcons";
import { Tooltip } from "./Tooltip";
import SettingsPluginView from "./SettingsPluginView";
import "../styles/PluginMarketPage.css";
// 顶栏直接复用看板的壳类（`.session-board-*`，见下方说明），显式引入其样式，
// 不依赖别处 import 的副作用。
import "../styles/SessionBoard.css";

/**
 * 插件市场整页（desktop 独有）。
 *
 * spec ecosystem/plugin.md 用户故事「插件市场」场景 1/2：从首页侧边栏「新对话」
 * 下方的入口打开，替换会话区（会话侧边栏保留、页面自带返回），入口是开关。
 *
 * 形态与「会话状态看板」（SessionBoard）同源——同为「替换会话区的整页视图」，
 * 故顶栏沿用看板那套壳类（`.session-board-toolbar` / `-back` / `-icon-btn` /
 * `-toolbar-divider` / `-mac-traffic`，含各自的深色覆盖），只新增页面根与内容区；
 * 否则收起侧边栏时会出现第二套红绿灯让位偏移（spec desktop-shell.md 场景 3 要求
 * 顶栏共用同一段让位机制）。
 *
 * 内容区直接复用设置页那份 SettingsPluginView —— 两处入口渲染同一套市场与插件
 * 视图，能力不得分叉（同 spec 假设 A-016），设置页的密度走查成果一并继承。
 */
export interface PluginMarketPageProps {
  /** 返回当前会话（顶栏返回钮；与再次点击侧边栏入口等价）。 */
  onBack: () => void;
  /** 侧边栏已收起：顶栏补「展开侧边栏」入口与分割线（看板同款）。 */
  collapsed?: boolean;
  onExpandSidebar?: () => void;
  /** macOS 隐藏标题栏 + 侧边栏收起 + 非全屏：顶栏最左端让出红绿灯区。 */
  macTrafficSpacer?: boolean;
  vscode?: { postMessage: (msg: unknown) => void };
}

export const PluginMarketPage: React.FC<PluginMarketPageProps> = ({
  onBack,
  collapsed = false,
  onExpandSidebar,
  macTrafficSpacer = false,
  vscode,
}) => (
  <div className="plugin-market-page" data-testid="plugin-market-page">
    <div className="session-board-toolbar">
      {macTrafficSpacer && (
        <div
          className="session-board-mac-traffic"
          aria-hidden="true"
          data-testid="plugin-market-mac-traffic"
        />
      )}
      {collapsed && (
        <>
          {onExpandSidebar && (
            <Tooltip text="展开侧边栏" position="bottom">
              <button
                type="button"
                className="session-board-icon-btn"
                onClick={onExpandSidebar}
                data-testid="plugin-market-expand-sidebar"
                aria-label="展开侧边栏"
              >
                <SidebarExpandIcon />
              </button>
            </Tooltip>
          )}
          <span className="session-board-toolbar-divider" />
        </>
      )}
      <button
        type="button"
        className="session-board-back"
        onClick={onBack}
        title="返回当前会话"
        data-testid="plugin-market-back"
      >
        <span className="codicon codicon-arrow-left" aria-hidden="true" />
        返回当前会话
      </button>
    </div>
    <div className="plugin-market-content">
      <SettingsPluginView vscode={vscode} />
    </div>
  </div>
);

export default PluginMarketPage;
