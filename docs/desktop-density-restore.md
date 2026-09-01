# 桌面端还原修复：同一套 token、两套参数

> 目标：wave-agent 的 cc 桌面端（desktop host）参照 codechat-ui（`/Users/ailsa/Documents/07-AI/CC/codechat-ui`，5175 原型）尽可能还原视觉；VS Code / JetBrains 插件端（IDE host）保持原有高信息密度。两套体系共用同一套 `--vscode-*` token，仅参数取值不同。

## 机制：data-host + host-desktop.css

- `html[data-host]` 标记当前宿主：`"desktop"`（cc 桌面端，中密度）/ `"ide"`（插件，高密度，默认）。
- `packages/webview/src/styles/host-desktop.css` 在 `[data-host="desktop"]` 下覆盖 token 取值与少数组件规则；经 esbuild 打包进 `dist/chat.css`，desktop 真机 syncWebview 内联、插件端加载但不触发（data-host 非 desktop）。

### data-host 设置点

| 文件                                           | 改动                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/webview/src/index.tsx`               | 新增 `document.documentElement.dataset.host = waveHostType === "desktop" ? "desktop" : "ide"`；import `host-desktop.css` |
| `packages/webview/prototype/preview-entry.tsx` | import `host-desktop.css`；`useEffect` 随 mock 用例 host 切换 `data-host`（桌面端用例 → desktop，IDE 用例 → ide）        |
| `packages/desktop/scripts/syncWebview.mjs`     | 生成的 `index.html` 静态声明 `data-host="desktop"`（真机桌面端恒为 desktop）                                             |

## 修改点清单

### 1. 新增 `packages/webview/src/styles/host-desktop.css`

桌面端中密度参数（浅色对齐 codechat-ui tokens，深色中性化去蓝）：

| 覆盖项                                                          | 插件默认（高密度） | 桌面端（中密度）                       | 对应 codechat token                 |
| --------------------------------------------------------------- | ------------------ | -------------------------------------- | ----------------------------------- |
| 主按钮 `--vscode-button-background`                             | `#0069cc`（蓝）    | `#1f2329`（炭黑）/ hover `#34383f`     | `--cc-action-primary`               |
| 次按钮 `--vscode-button-secondaryBackground`                    | 原值               | `#f0f0f1` / hover `#e7e9ed`            | `--cc-action-secondary`             |
| 用户气泡 `--vscode-chat-requestBubbleBackground`                | `#eef4fb`（浅蓝）  | `#f0f2f5`（中性浅灰）/ hover `#e7e9ed` | `--cc-fill`                         |
| 面板背景 `--vscode-panel-background`                            | `#fafafd`          | `#ffffff`（纯白会话区）                | `--cc-bg-conversation`              |
| 侧栏 `--vscode-sideBar-background`                              | `#fafafd`          | `#f7f8fb`（浅灰导航）                  | `--cc-bg-navigation`                |
| 代码块 `--vscode-textCodeBlock-background`                      | `#eaeaea`          | `#f7f8fa`                              | `--cc-bg-code`                      |
| 终端输出 `--vscode-terminal-background`                         | 终端底             | `#ffffff`（白底输出区）                | `--cc-bg-panel`                     |
| 边框 `--vscode-panel-border` / `widget-border` / `input-border` | 原值               | `#e4e7ed` / `#e4e7ed` / `#dcdfe6`      | `--cc-border-light` / `--cc-border` |
| 字号 `--vscode-font-size`                                       | 13px               | 14px                                   | `--cc-font-size-md`                 |

深色桌面端：主按钮 `#3d424a`（去蓝）、用户气泡 `rgba(255,255,255,.08)`（去蓝调）、终端输出 `#1d1e20`、字号 14px。

组件级覆盖：

| 规则                                                         | 效果                                                |
| ------------------------------------------------------------ | --------------------------------------------------- |
| `[data-host="desktop"] .ai-send-btn:disabled`                | 发送按钮空输入 = 浅灰禁用态（不再实心蓝 + 透明度）  |
| `[data-host="desktop"] .confirmation-dialog`                 | 确认弹窗遮罩弱化（codechat 轻量浮层，不遮死上下文） |
| `[data-host="desktop"] .permission-mode-select.mode-default` | 「修改前询问」默认模式中性灰（不再绿色）            |
| `[data-host="desktop"] .desktop-pane--focused::before`       | 焦点 pane 顶部指示条中性边框色（不再品牌蓝）        |

### 2. mock 用例补账号区（原型验收）

| 文件                                                  | 改动                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `packages/webview/prototype/mockShared.ts`            | 新增 `accountInfoMessage()` 构造器（`desktopAccountInfo` 窗口级快照：user/plan/apiQuota） |
| `packages/webview/prototype/mock/desktop-full.ts`     | messages 增加 `accountInfoMessage()`（delay 300）→ 侧栏底部显示头像 + 邮箱                |
| `packages/webview/prototype/mock/desktop-new-chat.ts` | messages 增加 `accountInfoMessage()`（delay 150）                                         |

## 验证结果

- 桌面端浅色（Electron 实测）：用户气泡 `rgb(240,242,245)` ✓、主按钮炭黑 `rgb(31,35,41)` ✓、面板白 ✓、侧栏 `#f7f8fb` ✓、字号 14px ✓、账号卡片出现 ✓、「修改前询问」中性灰 ✓、焦点 pane 条 `#e4e7ed` ✓。
- 插件端无回归：ide 用例 data-host=`ide`，用户气泡保持 `#eef4fb` 浅蓝 ✓。
- 深色桌面端：主按钮 `#3d424a`、气泡 `rgba(255,255,255,.08)`，无蓝调残留 ✓。
- 构建：`pnpm -F wave-webview compile` 通过，`dist/chat.css` 含 6 处 `data-host` 规则 ✓。

## 未修项（产品形态差异，非还原缺陷）

- 三栏分屏 pane（桌面端特有，`MessageList.css` 已有 `max-width: 800px` 内容列约束）。
- repo/branch/worktree 上下文选择器、「修改前询问」4 模式下拉（功能增强）。
- 深色/浅色主题切换按钮、pane 关闭/分屏按钮、侧栏搜索图标 vs 分屏图标。
- 确认弹窗保持居中卡片布局（codechat 为底部锚定卡片，需 JS 定位改造，记录待后续）。

---

# 第二轮：左侧导航 / AI 对话框 / 消息流细节还原（对齐 codechat 规格）

基准规格提取自 codechat-ui（`src/components/*.vue` + `src/styles/global.css` Figma parity 段 + `tokens.css`）。

## 修改点清单

### 1. 左侧导航（`packages/webview/src/styles/DesktopApp.css` + `DesktopSidebar.tsx`）

| 文件                                             | 改动                                                                                                                                            | 基准值                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `DesktopApp.css` `.desktop-sidebar`              | 宽度 240px → **260px**                                                                                                                          | `--cc-navigation-width: 260px`                                      |
| `DesktopSidebar.tsx`                             | 新增 macOS 红绿灯行 `.sidebar-window-row`（仅原型渲染：`window.waveHostType !== "desktop"` 判断，真机 Electron 系统标题栏已有红绿灯，避免重复） | `sidebar-window-row` 44px，红绿灯 12px 圆点 #ff5f57/#febc2e/#28c840 |
| `DesktopApp.css` `.desktop-sidebar-header`       | padding `12px 12px 4px` → `4px 12px 8px` + margin-top 4px（红绿灯行下方 logo 行）                                                               | `sidebar-brand-row` 32px                                            |
| `DesktopApp.css` `.desktop-sidebar-new-chat`     | 高 32px、圆角 4px→**8px**、字号 12→**13px**、字重 500、gap 8px、hover 用 `toolbar-hoverBackground`                                              | `sidebar-tool-button`：32px / 8px / 500                             |
| `DesktopApp.css` `.desktop-session-group-header` | 高 **32px**、圆角 4→**6px**、字号 12→**13px**、颜色 `descriptionForeground`（灰）、字重 500                                                     | `task-group-heading`：32px / #6c7076 / 500                          |
| `DesktopApp.css` `.desktop-session-group-name`   | 字重 600→**500**                                                                                                                                | `task-group-heading` 500                                            |
| `DesktopApp.css` `.desktop-session-tree`         | padding `0 6px 8px` → `4px 6px 8px`                                                                                                             | `task-groups` padding-top 12px                                      |
| `DesktopApp.css` `.desktop-session-item`         | min-height **32px**、padding `4px 6px 4px 20px` → `5px 8px 5px 16px`、圆角 4→**6px**、字号 12→**13px**                                          | `task-row`：32px / 6px / 13px                                       |
| `AccountCard.css` `.account-card-avatar`         | 头像底色 `--vscode-button-background` → **#ffebe8 底 + #c1292e 字**（浅红底红字首字母）                                                         | `sidebar-account` 头像：primary-soft 底 / primary 字                |

### 2. AI 对话框 composer（`packages/webview/src/styles/host-desktop.css`）

| 规则                                                | 改动                                                                                                                                            | 基准值                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `[data-host="desktop"] .message-input`              | min-height 40→**44px**、padding `12px`→`0 12px`（高度由 min-height 承担）                                                                       | composer textarea min-height 44px                              |
| `[data-host="desktop"] .input-content:focus-within` | 聚焦阴影改为 popover 柔影                                                                                                                       | `--cc-shadow-popover: 0 0 12px rgb(0 0 0/12%)`                 |
| `[data-host="desktop"] .toolbar-icon-button`        | 22→**32px**、圆角 4→**6px**                                                                                                                     | `composer-icon-button` 32×32 / 6px                             |
| `[data-host="desktop"] .compress-context-button`    | 高 **32px**、padding 0 6px                                                                                                                      | `compress-context-button` 32px                                 |
| `[data-host="desktop"] .permission-mode-select`     | 字号 12→**14px**、min-height **32px**、padding 0 6px                                                                                            | `permission-button`：14px / 32px                               |
| `[data-host="desktop"] .input-workdir-row`          | 从卡片内脚条改为 codechat contextbar 视觉：`margin -18px -1px -1px`、`padding 24px 12px 6px`、去 border-top、圆角 `0 0 16px 16px`、背景 #f5f7fa | `composer-contextbar`：margin-top -18px / #f5f7fa / 仅底部圆角 |
| `[data-host="desktop"] .ai-send-btn:disabled`       | 禁用态底色改用 `chat-requestBubbleBackground`（#f0f2f5）+ 文字 `#bec1c6`                                                                        | send-button disabled：fill 底 / text-disabled 字               |

### 3. 消息流（`host-desktop.css`）

| 规则                                          | 改动                                       | 基准值            |
| --------------------------------------------- | ------------------------------------------ | ----------------- |
| `[data-host="desktop"] .timeline-row::before` | 节点 6→**8px**（left -1px、top 15px 居中） | `design-node` 8px |

### 4. 其他（`host-desktop.css`，延续第一轮）

- 确认弹窗遮罩弱化、修改前询问默认模式中性灰、焦点 pane 指示条中性化（见第一轮文档）。

## 验证结果（v2，Electron 实测）

| 项                | 结果                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| 侧栏宽度          | 261px ✓                                                                        |
| 红绿灯            | 3 个 12px 圆点 ✓                                                               |
| 分组头            | 32px 高 / 13px ✓                                                               |
| 新对话按钮        | 32px 高 / 13px ✓                                                               |
| 工具行按钮        | 32px ✓                                                                         |
| 输入框 min-height | 44px ✓                                                                         |
| 时间线节点        | 8px ✓                                                                          |
| 账号头像          | #ffebe8 底 / #c1292e 字 ✓                                                      |
| 插件端回归        | ide 用例气泡 #eef4fb（保持原样）、无红绿灯 ✓                                   |
| 构建              | `pnpm -F wave-webview compile` 通过，`dist/chat.css` 含 13 处 data-host 规则 ✓ |

## 仍剩余的中等差异（记录，暂不修）

- 侧栏 logo 行第二图标：wave 用分栏面板图标（分屏功能），codechat 基准为搜索图标。
- 账号区显示用户名（displayNameFor 取 email 前缀），基准显示完整邮箱。
- 「修改前询问」带下拉 chevron（wave 为 4 模式下拉，功能增强）。
- 确认弹窗仍为居中卡片（codechat 底部锚定卡片需 JS 定位改造）。
- 红绿灯行右侧：codechat 有侧栏折叠切换按钮，wave 无（wave 分屏 icon 在 logo 行）。

---

# 第三轮：左侧导航细节还原（分组高度 / hover / 缩进规范 / chevron）

基准规格经 Electron 探针实测 5175 codechat DOM 得出（比视觉估算精确）：

| 基准项               | codechat 实测值                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `task-sidebar`       | padding `0 12px 12px`、宽 260px                                                                   |
| `task-group-heading` | 32px 高 / 14px / `#6c7076` / 500 / padding `0 8px` / gap 4px / **chevron 在文字右侧**（16px svg） |
| `task-row`           | 32px 高 / 14px / 400 / padding `5px 8px 5px 16px` / 圆角 6px / hover `#eef0f3`                    |

## 修改点清单

| 文件                                       | 改动                                                                                          | 基准值                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------ |
| `DesktopApp.css` `.desktop-sidebar`        | 加 `padding: 0 12px 12px`（缩进体系由 sidebar 统辖，替代 tree 自带 6px）                      | `task-sidebar` padding   |
| `DesktopApp.css` `.desktop-sidebar-header` | padding `4px 12px 8px` → `4px 0 8px`（左右缩进交给 sidebar 12px）                             | —                        |
| `DesktopApp.css` `.desktop-session-tree`   | padding `4px 6px 8px` → `4px 0 8px`（去左右 6px）                                             | —                        |
| `AccountCard.css` `.account-card`          | padding `8px 10px` → `8px 0`（左右缩进交给 sidebar 12px）                                     | `sidebar-account` 同款   |
| `host-desktop.css`                         | 侧栏文字密度 13→**14px**（new-chat / group-header / session-item）                            | `--cc-font-size-md` 14px |
| `host-desktop.css`                         | 分组 chevron 12→**16px**                                                                      | group-heading 16px svg   |
| `host-desktop.css`                         | hover：浅色 `#eef0f3` / 深色 `rgba(255,255,255,.08)`（替换 `list-hoverBackground` 蓝灰调）    | `--cc-fill-hover`        |
| `host-desktop.css`                         | 选中态：浅色 `#e7e9ed` / 深色 `rgba(255,255,255,.12)`（替换 color-mix 公式）                  | `--cc-fill-pressed`      |
| `host-desktop.css`                         | 分组间距 `margin-top: 4px`                                                                    | `task-group` gap 4px     |
| `host-desktop.css`                         | 分组头文字色：浅色 `#606060`（descriptionForeground 偏暗）→ **#6c7076**                       | `--cc-text-secondary`    |
| `DesktopSidebar.tsx`                       | **chevron 移到分组名右侧**（原 codicon 在左、name 在右；codechat 为 name + chevron，gap 4px） | group-heading 结构       |

## 验证结果（v3，Electron 探针实测）

| 项                          | wave 实测                                     | codechat 基准 |
| --------------------------- | --------------------------------------------- | ------------- |
| sidebar padding             | `0 12px 12px` ✓                               | 同            |
| sidebar 宽                  | 260px ✓                                       | 260px         |
| 分组头高/字号               | 32px / 14px ✓                                 | 同            |
| 分组头文字色（浅色）        | `rgb(108,112,118)` ✓                          | `#6c7076`     |
| 分组头文字左缘              | 20px ✓                                        | 20px          |
| chevron                     | 16px、位于 name 右侧、gap 4px ✓               | 同            |
| 会话行高/字号/padding       | 32px / 14px / `5px 8px 5px 16px` ✓            | 同            |
| 会话行文字左缘              | 28px ✓                                        | 28px          |
| 选中态（浅色）              | `rgb(231,233,237)` ✓                          | `#e7e9ed`     |
| hover（浅色，真实鼠标事件） | `rgb(238,240,243)` ✓                          | `#eef0f3`     |
| 红绿灯行                    | 44px / 12px 圆点 ✓                            | 同            |
| 插件端回归                  | ide 用例 data-host=`ide`、无桌面侧栏/红绿灯 ✓ | —             |
| 构建                        | `pnpm -F wave-webview compile` 通过 ✓         | —             |

---

# 第四轮：以 Figma 组件库为权威基准校正（替换 codechat 源码推断）

基准来源：Figma「CC桌面端组件库」（`v92f0XaCeMV7467qzIh6en`，节点 `13583-2226` 界面帧 / Sidebar - 任务导航组件）。经 REST API 逐节点提取 fills/stroke/cornerRadius/layout/text-style 得到权威值。

## 关键：Figma 权威值推翻 codechat 源码推断的项

| 项                | Figma 权威值                                       | 此前 codechat 推断             | 说明                                                         |
| ----------------- | -------------------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| 新对话按钮        | **实底 `#EBEDF0`** r8、文字 14px/**400**           | 无背景行、字重 500             | codechat 源码 sidebar-tool-button 为透明行，Figma 是实底按钮 |
| 会话行选中态      | `#EBEDF0`                                          | `#e7e9ed`（--cc-fill-pressed） | Figma 更深一档                                               |
| 时间线节点        | **12px / `#16A34A` 绿 / 白描边 2px**               | 8px 灰点（design-node）        | 尺寸、颜色、描边全部不同                                     |
| 账户热区          | 实底 `#EBEDF0` r6                                  | 透明                           | —                                                            |
| 账户文字          | **完整邮箱**（admin@corp.netease）14px/500         | email 前缀 12px                | 数据 + 字号                                                  |
| 侧栏右边框        | `#EBEEF5`                                          | panel-border `#e4e7ed`         | 更浅                                                         |
| logo 行左缘       | 20px（sidebar 12 + row 8）                         | 12px                           | 补 padding-left 8px                                          |
| composer 输入字号 | 14px / 行高 22px                                   | 12px/16px                      | —                                                            |
| placeholder 色    | `#8B8F95`                                          | input-placeholderForeground    | —                                                            |
| composer 卡片     | r16 / stroke `#DCDFE6` / **常态阴影 drop(0 8 24)** | 仅聚焦态有阴影                 | 补常态柔影                                                   |
| 红绿灯点          | 12px 圆 + stroke `#1F2329`@10%                     | 12px 圆（已有描边）            | 一致 ✓                                                       |

## 修改点清单

| 文件               | 改动                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host-desktop.css` | 新对话按钮实底 `#EBEDF0` + 字重 400（浅色）/ `rgba(255,255,255,.08)`（深色），hover `#e2e4e8`；选中态 `#e7e9ed`→`#EBEDF0`；账户热区实底 `#EBEDF0` r6；侧栏右边框 `#EBEEF5`；节点 12px `#16A34A` + 白描边 2px + 行 padding-left 12→20px；`message-input` 14px/22px；placeholder `#8B8F95`；composer 常态阴影 `0 8px 24px rgb(31 35 41/6%)` |
| `DesktopApp.css`   | `.desktop-sidebar-header` padding-left 8px（logo 左缘 20px 对齐分组头）                                                                                                                                                                                                                                                                   |
| `AccountCard.css`  | `.account-card-name` 字号 14px                                                                                                                                                                                                                                                                                                            |
| `AccountCard.tsx`  | 显示完整邮箱（`user.email`，回退 displayNameFor）                                                                                                                                                                                                                                                                                         |

## 验证结果（v4，Electron 探针实测，浅色/深色）

| 项                  | wave 实测                                                 | Figma                     |
| ------------------- | --------------------------------------------------------- | ------------------------- |
| 新对话按钮底 / 字重 | `rgb(235,237,240)` / 400 ✓                                | #EBEDF0 / 400             |
| 选中态（浅色）      | `rgb(235,237,240)` ✓                                      | #EBEDF0                   |
| 账户热区底          | `rgb(235,237,240)` ✓                                      | #EBEDF0                   |
| 账户文字            | admin@corp.netease.com 14px ✓                             | 完整邮箱 14px             |
| 侧栏边框            | `rgb(235,238,245)` ✓                                      | #EBEEF5                   |
| 节点                | 12×12 / `rgb(22,163,74)` / 描边 2px ✓                     | #16A34A                   |
| 行 padding          | 20px ✓                                                    | 12+8                      |
| 输入字号            | 14px/22px ✓                                               | 14/22                     |
| 卡片阴影            | `0 8px 24px rgb(31 35 41/6%)` ✓                           | drop(0 8 24)              |
| header padding      | `4px 0 8px 8px` ✓                                         | 左 8                      |
| 深色                | 新对话/热区 8% 白、选中 12% 白 ✓                          | —（Figma 无深色，中性化） |
| ide 回归            | data-host=`ide`、无桌面侧栏、timeline padding 保持 12px ✓ | —                         |
| 构建                | `pnpm -F wave-webview compile` 通过 ✓                     | —                         |

## 未修项（仍按 Figma 记录）

- 红绿灯行右侧「功能」图标按钮（24×24，#565A60）与 logo 行右侧第二图标（Figma 为搜索图标）——装饰性，功能未定。
- 「修改前询问」/「24%」等 composer 右侧组件的具体图标位形（wave 为自绘 SVG，尺寸已对齐）。
- 会话状态管理页（`13561:39312`，卡片列表视图）为独立页面，未纳入本轮。`

---

# 第五轮：按 Figma 界面帧「02 · 对话 / 预览区展开」(13497-15325) 逐项校准

基准：Figma 渲染图（`GET /v1/images` 2x PNG）+ 节点树完整 dump（含 221 行样式明细）。本轮以 vision 像素对比 + Electron 计算样式探针 + Python 像素级校验三重验证。

## 变更点清单

| #   | 项                   | Figma 权威值                               | wave 修复前                                           | 修复后（host-desktop.css）                               |
| --- | -------------------- | ------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------- |
| 1   | **用户气泡对齐**     | Article 内 `counterMAX` = 右对齐收缩气泡   | 全宽条 `width:100%`（左对齐铺满）                     | `width: fit-content; margin-left: auto` 右对齐收缩       |
| 2   | 用户气泡内边距       | `pad 12,12,8,8`                            | `8px 12px`                                            | `8px 12px`（= 12,12,8,8 ✓ 已有）                         |
| 3   | 用户气泡文字         | 14px / 500                                 | 12-13px / 400                                         | 14px / 500 / 行高 22px                                   |
| 4   | **时间线竖线左缘**   | 节点 12px 圆心 x=6px，竖线 `1x541 #E4E7ED` | 竖线 left 2.5px（按旧 6px 节点设计，12px 节点后错位） | left 5.5px 对齐 12px 节点圆心                            |
| 5   | 时间线竖线起止       | 从首节点圆心到末节点圆心                   | run--start/end 18px（旧 6px 点）                      | top/bottom 21px（12px 节点圆心）                         |
| 6   | 时间线竖线颜色       | `#E4E7ED`（浅色）                          | widget-border 50% 中灰（视觉过深）                    | 浅色 `#e4e7ed` / 深色 `rgba(255,255,255,.14)`，opacity 1 |
| 7   | 思考块字号           | 14px / 行高 22px                           | 13px / 0.9em                                          | 14px / 22px                                              |
| 8   | 思考块标题           | 14px / 600 / `#1F2329`                     | 13px / 600 / editor-foreground                        | 14px / 浅色 `#1f2329`                                    |
| 9   | 思考块正文           | 14px / 400 / `#6C7076`                     | descriptionForeground                                 | 浅色 `#6c7076`                                           |
| 10  | 思考块竖条           | `2x22 #E4E7ED`                             | 1px textBlockQuote-border                             | 2px `#e4e7ed`（浅）/ `rgba(255,255,255,.14)`（深）       |
| 11  | bash 工具块圆角      | r8                                         | r6                                                    | 8px                                                      |
| 12  | bash 命令/输出分隔线 | 无（输出区自带边框）                       | `border-bottom` 分隔线                                | 去除                                                     |
| 13  | bash 命令区          | `#F0F2F5` / 13px / pad 8,8,4,4             | textCodeBlock / 12px                                  | 底 `#f0f2f5`（token 已有）/ 13px / `8px 12px 4px`        |
| 14  | bash 输出区          | 13px / pad 4,12,8                          | 12px                                                  | 13px / `4px 12px 8px`                                    |
| 15  | 工具块链接           | `#2F5EDB` 无下划线                         | textLink + underline                                  | `#2f5edb`、去下划线                                      |
| 16  | 修改前询问 chevron   | 纯文字按钮无箭头                           | 带 `codicon-chevron-down`                             | desktop 下隐藏 caret                                     |

## 验证结果（v5）

| 项              | 实测                                                                                   | Figma                          |
| --------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| 用户气泡        | `width: fit-content`、右对齐（margin-left auto 生效）                                  | counterMAX 右对齐 ✓            |
| 气泡 pad / 字号 | `8px 12px` / 14px/500                                                                  | pad 12,12,8,8 / 14px/500 ✓     |
| bash 块         | r8 / 无分隔线 / 13px / 底 `rgb(240,242,245)`                                           | r8 / 无分隔 / 13px / #F0F2F5 ✓ |
| 时间线竖线      | 左 5.5px、浅色 `#e4e7ed`、Python 像素扫描确认贯穿（x=42 列 345 个连续灰像素 y144→998） | `1x541 #E4E7ED` ✓              |
| 思考块          | CSS 就位（mock 无数据未渲染，规则已生效）                                              | —                              |
| 构建            | `pnpm -F wave-webview compile` 通过 ✓                                                  | —                              |

## 仍未对齐的项（产品/功能差异，非样式缺陷，记录不修）

- **对话列宽度**：wave 三栏 pane 布局（侧栏 260 + 对话 + 第三栏），对话列实测 ~585px；Figma 该帧为 对话 900 + 预览 280。属布局产品形态差异。
- **右侧区域**：wave 第三栏默认是「新对话」面板（含本地/目录/分支/worktree 上下文栏），Figma 右侧为浏览器预览区（标签栏 + 地址栏 + 空态提示）。wave 有 PreviewPane 但当前 mock 未配置。
- **Header 右侧**：wave 多 pane 切换与关闭按钮（Figma 仅标题 + 单图标）。
- **「24%」上下文用量**：wave 有半环用量指示器，但 mock 未下发 contextUsage 数据故未显示；Figma 为「图标 + 24%」按钮形态。
- **新对话按钮胶囊底**：Figma dump 确认 `#EBEDF0` 实底（vision 目测误判为无底，以 API 数据为准）。
- **分组 chevron 方向**：Figma 该帧为折叠态「^」，wave 为展开态「˅」——状态差异，样式已对齐。

---

# 第六轮：侧栏行高盒模型修正（用户走查发现）

## 问题

`.desktop-session-item` 未设 `box-sizing`，默认 `content-box` 下 `min-height: 32px` 只约束内容区，叠加 padding 上下 5+5px 后**实际渲染 42px**（`getBoundingClientRect().height`），设计稿为 32px。

**根因**：此前探针用 `getComputedStyle().height`（返回 CSS 内容区 32px）误判为正确，未检查 `getBoundingClientRect`（真实盒高 42px）——测量指标选错，导致回归未发现。

## 变更点

| 文件                                      | 改动                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `DesktopApp.css` `.desktop-session-item`  | 加 `box-sizing: border-box`（min-height 32px 含 padding，总高 32px）      |
| `AccountCard.css` `.account-card-hotzone` | padding 上下 2px → 4px（24px 头像 + 8px = 32px，对齐 Figma hotzone 32px） |

## 验证（getBoundingClientRect 实测）

| 元素       | 修复前   | 修复后     | Figma |
| ---------- | -------- | ---------- | ----- |
| 会话行     | **42px** | **32px** ✓ | 32px  |
| 分组头     | 32px     | 32px ✓     | 32px  |
| 新对话按钮 | 32px     | 32px ✓     | 32px  |
| 红绿灯行   | 44px     | 44px ✓     | 44px  |
| 账户热区   | **28px** | **32px** ✓ | 32px  |
| 更多按钮   | 32px     | 32px ✓     | 32px  |

---

# 第七轮：AI 对话框（composer）结构还原（Figma 13439-9245）

## 问题

用户反馈「还原AI对话框，现在样式明显错乱」。对比 Figma `13439-9245`（新对话欢迎界面）：

- **灰条（contextbar）结构错误**：wave 把 `.input-workdir-row` 作为 `.input-content`（卡片）的**内部脚条**（子元素，margin `-18px -1px -1px` 拼接、圆角 `0 0 16px 16px`），视觉上贴卡片底零间隙生硬拼接、**吃掉卡片底部圆角**、工具行被削掉留白。
- **卡片高度 86px vs Figma 110px**：缺 pad-top 12px（textarea 文字贴卡片顶）、工具行 base 高 40px 贴底无 pad-bottom、gap 只有 4px（Figma 8px）。
- **灰条内容控件 20px 高**（Figma 按钮 32px）、圆角 4px（Figma 8px）。
- **卡片边框**：base 用 vscode input-border 半透明深色，Figma 浅色主题为 `#DCDFE6`。

## Figma 权威值（nodes API 直读 13439-9245）

| 元素                    | 值                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 卡片「Form - 发送消息」 | 768×110、pad (12,12,12,12)、gap 8、r16、fill `#FFFFFF`、stroke `#DCDFE6`、drop(0 8 24)                                                                                                                                          |
| 灰条「Form - 发送消息」 | 768×62、pad (12,6,12,6)、gap 8、**底部圆角 16（rectangleCornerRadii [0,0,16,16]）**、`#F5F7FA`、drop(0 8 24)；**顶边与卡片底重叠 18px**（灰条 y3599、卡片底 y3617），按钮 absolute y = 卡片底 +6，故视觉 padT = 18+6 = **24px** |
| 灰条按钮                | 32 高、r8（「本地」80×32、「选择工作目录」148×32）                                                                                                                                                                              |
| 工具行                  | 左两个 32×32 图标按钮；右「24%」59×32、「修改前询问」112×32、「发送」32×32 r8                                                                                                                                                   |

## 变更点

| 文件                                              | 改动                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MessageInput.tsx`                                | `.input-workdir-row` 从 `.input-content` **内部**（卡片脚条）移到其**后**（独立横条，与卡片同 x 同宽）                                                                                                                                                                                                                              |
| `host-desktop.css` `.input-workdir-row`           | `margin: -18px 0 0`（去 `-1px` 外扩）、`padding: 24px 12px 6px`（视觉 padT 24 = 重叠 18 + padT 6）、`border: none`、**`border-radius: 0 0 16px 16px`**（Figma rectangleCornerRadii [0,0,16,16]；顶被卡片遮 18px 无需圆角）、`background: #f5f7fa`、`box-shadow: 0 8px 24px rgb(31 35 41 / 6%)`、`align-items: flex-end`（按钮贴底） |
| `host-desktop.css` 深色灰条                       | `[data-theme="dark"] .input-workdir-row` 背景 `#27292B`（`--vscode-fill-light` 未定义会回退浅灰 #F5F7FA 在深色页面突兀；深灰比卡片 #313131 略深，形成卡片上/灰条下的层次）                                                                                                                                                          |
| `host-desktop.css` `.input-content`               | 加 `padding-top: 12px`（文字离卡片边 12px，与 Figma pad 一致）                                                                                                                                                                                                                                                                      |
| `host-desktop.css` `.input-buttons-row`           | `height: 40px → 32px`、`margin-top: 8px`（gap 8）、`margin-bottom: 12px`（pad-bottom）、`padding: 0 12px`                                                                                                                                                                                                                           |
| `host-desktop.css` 灰条内 trigger                 | `.desktop-host-trigger` / `.desktop-workdir-trigger` 加 `min-height: 32px`、`box-sizing: border-box`、`border-radius: 8px`（Figma 按钮规格；功能仍为 wave 扩展的 host/workdir/branch 选择器）                                                                                                                                       |
| `host-desktop.css` 浅色卡片                       | `border-color: #dcdfe6`（base 半透明深色 → Figma stroke）                                                                                                                                                                                                                                                                           |
| `host-desktop.css` `.input-content`（第二轮修正） | 加 `position: relative; z-index: 1`——灰条是卡片后兄弟元素默认绘制在上层，会盖住卡片底 18px 圆角；Figma 中灰条在卡片**后面**（顶部被卡片遮住），卡片需提层（灰条 dropdown 的 absolute z-index 10000 在根层仍高于卡片，不受影响）                                                                                                     |

## 验证（getBoundingClientRect 实测，light 主题）

| 元素                       | 修复前                                 | 修复后                                                | Figma                |
| -------------------------- | -------------------------------------- | ----------------------------------------------------- | -------------------- |
| 卡片高                     | **86px**                               | **110px** ✓                                           | 110px                |
| 卡片边框                   | 半透明深色                             | `#DCDFE6` ✓                                           | `#DCDFE6`            |
| 卡片阴影                   | focus 12%                              | `0 8px 24px 6%` ✓                                     | drop(0 8 24)         |
| 灰条高                     | 38.5px                                 | **62px** ✓                                            | 62px                 |
| 灰条 x/w                   | 与卡片同 x 同宽 ✓                      | 同 x 同宽 ✓                                           | 同宽                 |
| 灰条重叠                   | 拼接无重叠                             | **-18px** ✓                                           | -18px                |
| 按钮顶距卡片底             | —                                      | **+6px** ✓                                            | +6px                 |
| 按钮底距灰条底             | —                                      | **+6px** ✓                                            | +6px                 |
| 灰条按钮高                 | 20px                                   | **32px** ✓                                            | 32px                 |
| 工具行高                   | 40px                                   | **32px** ✓                                            | 32px                 |
| 输入区高                   | 44px                                   | 44px ✓                                                | 44px                 |
| 重叠带层级（第二轮修正）   | 灰条盖卡片（`elementFromPoint` = row） | **卡片盖灰条**（`elementFromPoint` = input-content）✓ | 灰条在卡片后         |
| 灰条圆角（第三轮修正）     | `0`                                    | **`0 0 16 16`** ✓                                     | [0,0,16,16]          |
| 灰条深色背景（第三轮修正） | `#F5F7FA`（回退浅灰突兀）              | **`#27292B`** ✓                                       | 浅色无规格；深灰层次 |

---

# 第八轮：composer 图标 / 权限交互 / 下拉菜单还原（codechat-ui 为参照）

## 背景

用户要求"以 Figma 为最终权威，codechat-ui 为实现参照"继续还原 AI 对话框。核对 codechat-ui `ComposerBox.vue` 与 `assets/figma/*.svg`（Figma 直接导出）后确认 wave 多处偏差：

- **权限按钮按模式着色**（绿/黄/蓝/红加粗），Figma/codechat 为统一中性 `#565A60`（仅「跳过权限确认」danger 红）
- **下拉菜单无图标**、vscode token 深色底/r4/12px，Figma/codechat 为白底 r12/#EBEEF5/popover 阴影/32 高 item 带图标 gap 10/14px
- **图标非 Figma 形状**：`/` 按钮是自定义斜杠方块（Figma 为「圆角方块+斜线」Subtract+Line325）；发送是实心箭头（Figma 为 stroke 1.5 描边箭头）；权限 4 图标是 fill 实心盾（Figma 为 stroke 1.4 描边盾系）；chevron 是 codicon 16px（Figma 为 8×5 细箭头）；灰条用 codicon folder（Figma 为目录 stroke 图标）
- 发送按钮 idle 态背景是 `--vscode-button-background`（Figma 为 `#F0F2F5` + `#ADB0BB` 图标，激活 `#1F2329` + 白）

## 变更点

| 文件                                                     | 改动                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HeaderIcons.tsx`                                        | 权限 4 图标替换为 Figma stroke 版（`permission-ask/auto-accept/skip/plan.svg` path）；`SlashBoxIcon` 替换为 `composer-settings.svg`（圆角方块+斜线，20×20）；新增 `SendArrowIcon`（`send.svg` stroke 箭头，与 queue 的 fill 箭头区分）、`PermCaretIcon`（`composer-chevron` 8×5）、`ContextLocalIcon`（`composer-context-local`）、`ContextDirectoryIcon`（`composer-context-directory`）                         |
| `MessageInput.tsx`                                       | 发送按钮用 `SendArrowIcon`；权限 caret 从 codicon 换 `PermCaretIcon`；权限菜单项加图标（`permissionModeIcon(m.value)` + mode 类）                                                                                                                                                                                                                                                                                 |
| `DesktopHostSelector.tsx` / `DesktopWorkdirSelector.tsx` | 灰条 trigger 的 codicon 换 `ContextLocalIcon` / `ContextDirectoryIcon` + `PermCaretIcon`                                                                                                                                                                                                                                                                                                                          |
| `host-desktop.css`                                       | 工具行图标按钮色 `#4E5969`、hover `#F0F2F5`；权限按钮统一 `#565A60`（仅 bypass 模式 `#D92D20`）、hover `#EEF0F3`；权限菜单/plus-menu 白底 r12 `#EBEEF5` popover 阴影、item 32 高带图标 gap 10、active `#1F2329`、danger hover `#FFF0EF`；发送按钮 idle `#F0F2F5`+`#ADB0BB` / 激活 `#1F2329`+白；灰条 trigger 14px `#565A60`、图标 16px、caret 8×5；删除两条残留规则（旧 `mode-default` 色、caret `display:none`） |

深色模式语义映射：菜单底 `#27292B`、图标/文字 `#9A9EA5`、hover `rgba(255,255,255,.08)`、发送激活反白（`rgba(255,255,255,.92)` 底 + `#1F2329` 图标）。

## 验证（getComputedStyle 实测，light/dark）

| 元素             | 修复前                      | 修复后                                                        | Figma/codechat    |
| ---------------- | --------------------------- | ------------------------------------------------------------- | ----------------- |
| 权限按钮文字     | 按模式着色                  | **`#565A60`** ✓（dark `#9A9EA5`）                             | `#565A60`         |
| 权限按钮 caret   | codicon 16px                | **8×5** ✓（composer-chevron path）                            | 8×5               |
| 权限菜单         | vscode token 深底/r4/无图标 | **白底 r12 `#EBEEF5`、item 32 高、gap 10、图标 16px、14px** ✓ | 同                |
| 发送 idle / 激活 | button-background           | **`#F0F2F5`+`#ADB0BB` / `#1F2329`+白** ✓                      | 同                |
| `/` 按钮图标     | 斜杠方块                    | **圆角方块+斜线**（Subtract+Line325）✓                        | composer-settings |
| 灰条 trigger     | codicon folder/12px         | **Figma 目录/本地图标 16px、14px `#565A60`** ✓                | 同                |
| 灰条 caret       | codicon 16px                | **8×5** ✓                                                     | 8×5               |
| 菜单项图标       | 无                          | **16px Figma stroke 图标** ✓                                  | 同                |

---

# 附：基础设施与工具（还原工作依赖，非样式改动）

| 文件                                       | 说明                                                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                             | 新增脚本：`prototype:build` / `prototype:build:watch` / `prototype:serve` / `prototype`（原型预览应用构建与启动）                                                     |
| `prototype/`                               | 原型预览应用（独立 Vite 构建）：`index.html`（`data-host` 声明）、`scripts/build.mjs`、`serve.mjs`、`src/mockHost.ts`（mock 宿主：waveHostType 注入、红绿灯渲染开关） |
| `packages/webview/prototype/mockShared.ts` | mock 消息构造器集（`accountInfoMessage`/`toolMsg`/`editMsg`/`sessionMeta` 等），desktop 各用例共用                                                                    |
| `scripts/figma-dump.py`                    | Figma 节点样式提取工具（需 `X-Figma-Token` 环境变量），用于从组件库 API 输出 fill/stroke/cornerRadius/text-style 基准                                                 |

以上为还原校验与 mock 验收的支撑设施，不改变插件端（ide host）运行时行为。

---

# 第九轮：整体走查修复（Figma「界面」画布 4 帧基准）

基准：Figma 组件库（`v92f0XaCeMV7467qzIh6en`）「界面」画布 4 帧——`13437:781` 01·新对话、`13497:15325` 02·对话/预览区展开、`13497:15760` 02·对话/预览区收起、`13495:12985` 02·左导航收起。经 REST API 直读节点样式 + 渲染图 2x + Playwright 探针（`getComputedStyle`/`getBoundingClientRect`）逐项对照。

## 变更点清单

| #   | 项                     | Figma 权威值                                              | wave 修复前                                                  | 修复后（host-desktop.css 等）                          |
| --- | ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| 1   | **工具行图标色**       | `#565A60`（13497:15726 各 VECTOR）                        | `#4e5969`（第八轮按 codechat 推断）                          | `#565a60`                                              |
| 2   | **发送按钮 idle 图标** | stroke `#BEC1C6`（13437:960）                             | `#adb0bb`                                                    | `#bec1c6`                                              |
| 3   | **Bash 工具块圆角**    | **r12**（13438:8029，fill #F0F2F5 stroke #DCDFE6）        | r8（第五轮按当时帧定）                                       | `12px`                                                 |
| 4   | Bash 工具块外层描边    | `#DCDFE6`                                                 | `#E4E7ED`（widget-border 透出）                              | 浅色 `#dcdfe6`                                         |
| 5   | **Bash 输出区**        | 白底 `#FFFFFF` + 独立描边 `#DCDFE6`（13438:8032 746×130） | 与命令区同容器无独立框                                       | 浅色下补 `1px #dcdfe6` 边框 + 白底                     |
| 6   | **账户热区**           | 常驻实底 `#EBEDF0` r6（13497:15327 13498:17132 195×32）   | 工作区改动为「默认透明、hover 才显」（与 Figma 矛盾）        | 恢复常驻实底 `#ebedf0` / hover `#e2e4e8`（深色 8% 白） |
| 7   | **侧栏总宽**           | 260（含 pad 12，content 235）                             | content-box 260 + pad 24 + border 1 = **285px**（超宽 25px） | `box-sizing: border-box` → 总宽 260                    |
| 8   | **Header 总高**        | 44（含底部 stroke）                                       | content-box 44 + border 1 = **45px**                         | `box-sizing: border-box` → 总高 44                     |
| 9   | Header 底部边框        | `#EBEEF5`（13497:15329 stroke）                           | `#E4E7ED`（widget-border）                                   | 浅色 `#ebeef5`                                         |
| 10  | **Header 标题**        | 14px/600 `#1F2329`                                        | 13px/600、foreground 色                                      | 14px/600/行高 22、浅色 `#1f2329`                       |
| 11  | Write 块标题           | 14px/600（13438:8038）                                    | 13px/600                                                     | `14px`                                                 |
| 12  | Write 路径             | 13px Menlo `#2F5EDB` 无下划线（13438:8039）               | 12px 蓝 `#48a0c7` 虚线下划线                                 | 13px、去下划线、浅色 `#2f5edb` / 深色 `#9a9ea5`        |
| 13  | Write 文件统计         | 12px `#6C7076`（13439:9463）                              | 11px descriptionForeground                                   | 12px、浅色 `#6c7076`                                   |

## 验证结果（Playwright 探针实测，light/dark）

| 项                         | wave 实测                                         | Figma                    |
| -------------------------- | ------------------------------------------------- | ------------------------ |
| 工具行图标色               | `rgb(86,90,96)` ✓                                 | #565A60                  |
| 发送 idle 图标             | `rgb(190,193,198)` ✓                              | #BEC1C6                  |
| Bash 块圆角                | `12px` ✓                                          | r12                      |
| Bash 输出区                | 白底 + `1px #DCDFE6` ✓                            | #FFF + stroke #DCDFE6    |
| 账户热区（浅色/深色）      | `rgb(235,237,240)` ✓ / `rgba(255,255,255,.08)` ✓  | #EBEDF0 / —              |
| 侧栏总宽                   | `260px`（border-box）✓                            | 260                      |
| Header 总高 / 标题         | `44px` / `14px #1f2329` ✓                         | 44 / 14px/600 #1F2329    |
| 时间线节点/竖线（回归）    | 12px #16A34A 白描边 / `#e4e7ed` left 5.5 top 21 ✓ | 同（前轮已对齐，无回归） |
| composer 灰条/卡片（回归） | 62px / 110px、r16、`#dcdfe6`、shadow ✓            | 同（前轮已对齐，无回归） |
| 用户气泡（回归）           | fit-content 右对齐、14px/500 ✓                    | 同                       |
| 构建                       | `pnpm -F wave-webview compile` 通过 ✓             | —                        |
| 类型                       | `pnpm -F wave-webview type-check` 通过 ✓          | —                        |
| 插件端回归                 | ide 用例 data-host=`ide` 不触发任何新规则 ✓       | —                        |

## 本轮未修（记录，非样式缺陷）

- **消息区/输入区外边距**：wave 10px vs Figma Article pad 16——虚拟列表行 inset（`virtual-row` left/right 10px）与 sticky 补偿强联动，且对话列宽度 585px（三栏分屏）vs Figma 800px 属既有产品形态差异，边距随列宽一并记录，不单独改。
- 对话列宽度 585 vs 800、右侧第三栏内容（wave「新对话」面板 vs Figma 浏览器预览区）、Header 右侧多 pane 按钮——既有产品差异，沿用前轮结论。
- 设置页 / 会话状态页为独立页面，未纳入本轮。

---

# 第十轮：codechat-ui 样式参考再走查（侧栏密度 / 账户区 / composer 间距 / 预览标签）

基准：以 codechat-ui（`src/styles/global.css` + `tokens.css`）为样式参考再修改一轮；冲突点以 Figma「CC桌面端组件库」权威值（REST API 直读 13497-15325 节点树）为准。本轮**仅改样式，未推送 git**（用户指示多轮修改完成后再统一推送）。

## 走查结论：codechat 与 Figma 冲突、wave 保持 Figma 的项（不修）

| 项                  | codechat 源码值        | Figma 权威值                   | wave 现状   |
| ------------------- | ---------------------- | ------------------------------ | ----------- |
| header 左右 padding | `0 16px`               | 12px（13497:15329）            | 12px ✓      |
| 新对话按钮          | 透明底 / 500           | 实底 `#EBEDF0` / 400           | Figma 值 ✓  |
| 会话行选中态        | `#e7e9ed`（pressed）   | `#EBEDF0`                      | Figma 值 ✓  |
| 发送按钮            | 34×34                  | 32×32（13437:958）             | 32×32 ✓     |
| 权限按钮字号        | 13px（--font-size-sm） | 14px（13498:16766）            | 14px ✓      |
| 消息气泡            | 10px 13px / `#f5f7fa`  | 8px 12px / `#F0F2F5`           | Figma 值 ✓  |
| 时间线节点          | 14px                   | 12px / `#16A34A` 白描边        | 12px ✓      |
| composer 阴影       | 8%                     | drop(0 8 24) **visible:false** | 6%（弱化）✓ |

## 变更点清单（host-desktop.css）

| #   | 项                     | codechat 参考                          | Figma 权威值                                              | wave 修复前                                    | 修复后                                                          |
| --- | ---------------------- | -------------------------------------- | --------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| 1   | 品牌行高度             | `sidebar-brand-row` 32px               | 13498:17095 高 32px                                       | 不定高（实测 36px = 4+24+8）                   | `height: 32px` + 垂直居中、pad-left 8                           |
| 2   | 品牌行右侧图标组间距   | gap 8px                                | 13498:17097 itemSpacing 8                                 | gap 4px                                        | `gap: 8px`                                                      |
| 3   | 新对话按钮与品牌行间距 | `task-sidebar` 内 12px                 | 13498:17094 itemSpacing 12                                | margin-top 4px                                 | `margin: 12px 0 4px`                                            |
| 4   | 账户区分隔线           | `border-top: var(--cc-border-lighter)` | Sidebar 分隔 `#EBEEF5`                                    | `#e4e7ed`（panel-border）                      | 浅色 `#ebeef5`                                                  |
| 5   | 账户热区左右内边距     | `sidebar-account-details` pad 0 8px    | 13498:17132 padL/R 8                                      | 左 4px（头像偏左）                             | `padding: 4px 8px`（对称 8）                                    |
| 6   | Composer 外间距        | `composer-wrap` 20 24 18               | 13497:15726 Container pad **16** 四边                     | 左右 10 + 上下 10 = 20                         | `input-area-container` 16px + `input-container` 0（总 16 四边） |
| 7   | Composer 卡片最大宽    | `--cc-conversation-max-width: 768px`   | Form - 发送消息 768px（Container 800）                    | `input-wrapper` 800px（宽 pane 下卡片宽 32px） | `max-width: 768px`                                              |
| 8   | 预览标签               | —（组件库同款 tab）                    | 13561:39645 **r8** / 文字 14px / pad 8 / active `#F0F2F5` | 胶囊 r13 / 12px / pad 10 / active 10% 前景     | `r8` / 14px / pad 0 4px 0 8px / 浅色 active `#f0f2f5`           |

welcome 态输入区：第十轮实测发现 `.chat-container--welcome .input-area-container` 与 `[data-host="desktop"] .input-area-container` specificity **相等**（属性选择器与类同为类级 (0,2,0)），desktop 规则后加载会覆盖居中 padding——已在第十一轮移入 host-desktop.css 显式恢复（见第十一轮章节）。

## 验证结果（Playwright 探针实测）

| 项                        | wave 实测                      | Figma / codechat |
| ------------------------- | ------------------------------ | ---------------- |
| 品牌行高                  | 32px ✓                         | 32px             |
| 新对话按钮 margin-top     | 12px ✓                         | 12px             |
| 账户区分隔线（浅色）      | `rgb(235,238,245)` = #EBEEF5 ✓ | #EBEEF5          |
| 账户热区 padding          | `4px 8px` ✓                    | pad 左右 8       |
| input-area-container      | `16px` 四边 ✓                  | pad 16           |
| input-container           | `padding: 0` ✓（总 16）        | —                |
| composer 卡片宽           | 557px（pane 内 = 589 − 32）✓   | 响应式           |
| 用户消息（回归）          | 右对齐 fit-content、14px/500 ✓ | counterMAX ✓     |
| 侧栏/账户热区实底（回归） | `#EBEDF0` ✓                    | #EBEDF0          |

## 本轮未修（记录）

- 消息区 padding 10px vs Figma Article 16px：仍受虚拟列表行 inset 联动约束（第九轮结论不变，本轮仅修输入区）。
- 对话列宽度 585 vs 800：三栏分屏产品形态差异（前轮结论）。
- 预览标签深色 active 态：Figma 仅浅色，深色沿用中性 10% 前景。

---

# 第十一轮：welcome 帧细节对齐（gap / 居中限宽 / 输入规格 / 账户区底部）

基准：Figma welcome 帧（13437:781）权威值 + codechat-ui 参考；本轮**仅改样式，未推送 git**。

## 变更点清单

| #   | 项                         | Figma 权威值                                               | wave 修复前                        | 修复后                                                        |
| --- | -------------------------- | ---------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| 1   | welcome logo→composer 间距 | 13498:18408 itemSpacing **40**                             | gap 44px                           | `gap: 40px`（ChatApp.css）                                    |
| 2   | welcome 输入卡片居中限宽   | 13498:18357 composer **768px**（Container 800 − pad 16×2） | max(10, (100% − 760px)/2)          | 760 → **768px**，规则移入 host-desktop.css 并提高 specificity |
| 3   | welcome 输入框规格         | welcome 复用标准 Form：**44px / 14px / 22px**              | 特化 48px / 13px / 20px            | 删除特化规则，统一 desktop 44px / 14px / 22px                 |
| 4   | 账户区底部贴合             | 17131 账户区高 **41** = pt 8 + 内容 32 + 分隔线 1（无 pb） | padding 8px 0（总高 49，底空 8px） | `padding: 8px 0 0`（总高 41 ✓）；底距 12px 由 sidebar pb 提供 |

## 重要发现：welcome 居中规则此前被 desktop 覆盖压掉（第十轮文档结论有误）

第十轮文档称 `.chat-container--welcome .input-area-container`（0,2,0）高于 `[data-host="desktop"] .input-area-container`（0,1,1）——**该 specificity 计算错误**：属性选择器与类选择器同为类级（b 级），两条规则实际都是 **(0,2,0)** 相等，host-desktop.css 后加载 → `padding: 16px` 覆盖 welcome 居中规则（探针实测 welcome 态 pl=16px，移除 desktop 规则后回落到 10px 证实）。

修复：welcome 居中规则从 ChatApp.css 移入 host-desktop.css，写成 `[data-host="desktop"] .chat-container--welcome .input-area-container`（specificity (0,3,0)），同文件后置双保险。

## 验证结果（Playwright 探针实测）

| 项                                   | wave 实测                          | Figma 权威值 |
| ------------------------------------ | ---------------------------------- | ------------ |
| welcome 品牌→输入间距                | gap 40px ✓                         | 40           |
| welcome 输入区 pl/pr（窄 pane 589）  | 10px ✓（max(10, (589−768)/2)=10）  | 响应式       |
| welcome 输入区 pl/pr（宽 pane 1069） | 150px ✓（=(1069−768)/2，居中生效） | 768 限宽     |
| message-input                        | min-height 44px / 14px / 22px ✓    | 44/14/22     |
| account-card                         | padding `8px 0 0`、总高 41px ✓     | 41           |

## 本轮未修（记录）

- timeline run 内活动间距 10px vs Figma 16px（8008 Frame itemSpacing 16）：行间距由 MessageList.tsx 的 timelineRuns.paddings 内联 paddingBottom 驱动（run 内 0、消息级 14），CSS 无法覆盖内联值；改共享 TSX 影响 IDE host，负 margin 对虚拟列表测量有风险——暂缓。
- welcome 消息区（对话列表为空，无内容）、Header 右侧多 pane 按钮、对话列宽度 585 vs 800——既有产品形态差异（前轮结论）。

---

# 第十二轮：取消新对话/账户热区常驻实底（用户反馈）

用户预览反馈：「新对话」按钮与账户信息**始终处于选中状态**——根因是第三轮按 Figma 读数把两个元素做成**常驻实底**（浅色 #EBEDF0 / 深色 8% 白），常态下形似选中态。用户要求去掉常驻底（产品决策优先于 Figma 读数）。

## 变更点清单（host-desktop.css）

| #   | 项         | 修复前（第三轮 Figma 实底化）          | 修复后（第十二轮）                                                                   |
| --- | ---------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | 新对话按钮 | 常驻 `#EBEDF0`（深色 8% 白）+ 400 字重 | 常态透明（回 base 无背景行），hover `#E2E4E8`（深色 14% 白）保留；字重保持 Figma 400 |
| 2   | 账户热区   | 常驻 `#EBEDF0`（深色 8% 白）           | 常态透明，hover/focus `#E2E4E8`（深色 14% 白）保留                                   |

## 验证结果（Playwright 探针实测）

| 项         | 常态背景      | hover 背景           |
| ---------- | ------------- | -------------------- |
| 新对话按钮 | transparent ✓ | `rgb(226,228,232)` ✓ |
| 账户热区   | transparent ✓ | `rgb(226,228,232)` ✓ |

## 本轮未修（记录）

- 无。改动仅 2 项，深色主题 hover 沿用既有 14% 白反馈。

---

# 第十三轮：统一所有下拉菜单/弹层样式（对齐 codechat 菜单规格）

用户指示「参考设计稿和项目代码，统一所有下拉菜单的样式」。盘点发现：仅 permission-mode-menu 与 plus-menu 此前按 codechat 对齐（白底/#EBEEF5/r12/柔影/32px item），其余 15 个下拉菜单/弹层仍沿用 VS Code token（r4-8、深影、item 24px/12px、蓝灰选中态），视觉割裂。

## 权威规格（codechat-ui src/styles/global.css + tokens.css）

| 维度         | 值                                                           | 变量                                     |
| ------------ | ------------------------------------------------------------ | ---------------------------------------- |
| 面板背景     | #FFFFFF                                                      | --cc-bg-panel                            |
| 面板边框     | #EBEEF5                                                      | --cc-border-lighter                      |
| 面板圆角     | 12px                                                         | --cc-radius-lg                           |
| 面板阴影     | 0 0 12px rgb(0 0 0 / 12%)                                    | --cc-shadow-popover                      |
| 面板 padding | 8px                                                          | --cc-space-2                             |
| 菜单项       | min-height 32px / 14px / 500 / r6 / pad 0 8px / 默认 #565A60 | --cc-control-height-sm 等                |
| item hover   | 背景 #EEF0F3、文字 #1F2329                                   | --cc-fill-hover                          |
| item 选中    | 背景 #E7E9ED、文字 #1F2329                                   | --cc-fill-pressed                        |
| 危险项       | 文字 #D92D20、hover 背景 #FFF0EF                             | --cc-color-danger / --cc-diff-removed-bg |
| 分隔线       | 1px #EBEEF5                                                  | --cc-border-lighter                      |

## 变更点清单（host-desktop.css「第十三轮」段）

| #   | 对象                                                                                                                                                                                                         | 统一前                                                        | 统一后                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | 简单菜单面板：`.more-menu` `.panel-toggle-menu` `.desktop-session-menu` `.desktop-workdir-menu`                                                                                                              | menu/dropdown-background token、r8、`0 2px 8px 36%`、pad 4-8  | 白底 / #EBEEF5 / r12 / 12% 柔影 / pad 8                                                                   |
| 2   | 简单菜单项                                                                                                                                                                                                   | 24px / 12px / 500 / r4                                        | 32px / 14px / 500 / r6 / pad 0 8px / 默认 #565A60 / gap 8                                                 |
| 3   | 危险项（more、session-menu）                                                                                                                                                                                 | errorForeground #F14C4C + list-hover                          | #D92D20 + hover 红软底 #FFF0EF                                                                            |
| 4   | 分隔线 `.more-menu-separator`                                                                                                                                                                                | menu-separatorBackground                                      | #EBEEF5（深色 12% 白）                                                                                    |
| 5   | 复杂弹层面板：`.session-list-popup` `.slash-commands-popup` `.file-suggestion-dropdown` `.rewind-popup` `.model-popup` `.btw-panel` `.history-search-popup` `.account-usage-popup` `.desktop-remote-browser` | dropdown-background、r4-8、`0 4px 12px`                       | 白底 / #EBEEF5 / r12 / 12% 柔影                                                                           |
| 6   | 复杂弹层 item 交互                                                                                                                                                                                           | list-hoverBackground / list-activeSelectionBackground（蓝灰） | hover #EEF0F3 / 选中 #E7E9ED / 文字 #1F2329                                                               |
| 7   | 面板内分隔线与 header                                                                                                                                                                                        | dropdown-border / editor-background                           | #EBEEF5（header 与面板同底）                                                                              |
| 8   | 弹层主文字                                                                                                                                                                                                   | 12-13px                                                       | 14px（rewind/model/history/slash-name/session-list-title）                                                |
| 9   | 深色主题全套                                                                                                                                                                                                 | —                                                             | 面板 #27292B / 12% 白边框 / 40% 柔影 / item #9A9EA5 / hover 8% 白 / 选中 12% 白 / 危险 #F4655C + 20% 红底 |

## 验证结果（Playwright 探针实测，light/dark）

| 项                                                            | wave 实测                             | codechat          |
| ------------------------------------------------------------- | ------------------------------------- | ----------------- |
| 面板（more/panel/session/workdir/slash/permission/plus 回归） | 白底 / #EBEEF5 / r12 / 12% 柔影 ✓     | 同                |
| 简单菜单项                                                    | minH 32 / 14px / 500 / r6 / #565A60 ✓ | 同                |
| 危险项（浅色）                                                | #D92D20 ✓                             | 同                |
| 深色面板                                                      | #27292B / 12% 白边框 / 40% 影 ✓       | —                 |
| 深色 item / danger                                            | #9A9EA5 / #F4655C，hover 20% 红底 ✓   | —                 |
| slash 项选中态                                                | #E7E9ED ✓（输入 / 自动高亮首项实测）  | --cc-fill-pressed |
| compile                                                       | 通过 ✓                                | —                 |

## 本轮未修（记录）

- 复杂弹层 item 的 padding/radius 保留各自内容布局（slash 双行 40px、file-suggestion 40px 双行），仅统一面板外观与交互色。
- `.queued-message-list-container`（排队消息浮层）为悬浮面板非下拉菜单，未纳入。
- session-list-popup 在桌面端 header 无触发按钮（IDE 场景使用），样式规则已覆盖但未在桌面端实测。

## 第十四轮：4 项元素评论修复（会话项选中色 / 新对话边距 / 面板切换图标 / pane 关闭图标）

评论：会话项「选中色值不对」、新对话 tooltip「图标边距等不对」、header「面板切换图标不对」、pane「关闭按钮图标不对」。

### 变更点清单

| #   | 对象                     | 修复前                                                                | 修复后（权威依据）                                                                                                          |
| --- | ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | 会话项选中色（浅色）     | `#EBEDF0`（第三轮 Figma 读数）                                        | `#E7E9ED` = `--cc-fill-pressed`（skill 契约：导航/列表选中用中性 pressed fill；codechat 桌面壳 `.task-row.is-active` 同值） |
| 2   | 会话项弱化态 `--visible` | VS Code 蓝灰 `inactiveSelectionBackground`（浅 #E4E6F1 / 深 #37373D） | 中性灰：浅 `#EEF0F3`（= --cc-fill-hover）、深 `rgba(255,255,255,0.06)`，弱于选中态                                          |
| 3   | 选中项标题字重           | 400                                                                   | 500（codechat 桌面壳 `.task-row.is-active .task-title` 同值）                                                               |
| 4   | 选中项 hover             | 回落 hover 色 #EEF0F3                                                 | 保持 pressed `#E7E9ED`（codechat `.task-row-wrap:hover .task-row.is-active` 同值）                                          |
| 5   | 新对话按钮横向位置       | tooltip 锚点 `padding: 0 6px` 把按钮右移 6px（图标左缘 26px）         | `padding: 0`，按钮贴侧栏 12px、图标左缘 20px（codechat `sidebar-tool-button`：容器 10px + 8px）                             |
| 6   | 新对话按钮 hover 色      | `#E2E4E8`                                                             | `#EEF0F3` = `--cc-fill-hover`（codechat `sidebar-tool-button:hover` 同值）                                                  |
| 7   | header 面板切换图标      | `codicon-layout-sidebar-right` + `codicon-chevron-down`（36×22）      | Figma `preview-toggle` 复合图标（40×24：右侧面板布局 + chevron-down），codechat `workspace-header-panel-toggle` 同款        |
| 8   | pane 关闭图标            | `codicon-close`（VSCode 粗 ×）                                        | Figma `conversation-close`（16×16 细 ×）                                                                                    |

### 验证结果（Playwright 探针实测）

| 项                                   | 实测                         | 期望 |
| ------------------------------------ | ---------------------------- | ---- |
| 浅色 `--current` 背景                | `rgb(231,233,237)` = #E7E9ED | ✓    |
| 浅色 `--visible` 背景                | `rgb(238,240,243)` = #EEF0F3 | ✓    |
| 深色 `--current` / `--visible`       | 12% 白 / 6% 白               | ✓    |
| 选中项 hover（浅色）                 | #E7E9ED（保持 pressed）      | ✓    |
| 选中项标题字重                       | 500                          | ✓    |
| 新对话按钮 图标左缘 / hover 背景     | 20px / #EEF0F3               | ✓    |
| 面板切换按钮 40×24（图标同尺寸）     | ✓                            | ✓    |
| pane 关闭 16×16 细 ×（22×22 按钮内） | ✓                            | ✓    |
| compile                              | 通过                         | ✓    |

### 实现文件

- `src/styles/host-desktop.css`（选中/弱化/hover/字重）
- `src/styles/DesktopApp.css`（新对话 tooltip 锚点 padding）
- `src/components/HeaderIcons.tsx`（新增 `PanelToggleIcon`、`ConversationCloseIcon`）
- `src/components/ChatHeader.tsx` / `src/styles/ChatHeader.css`（面板切换图标 + 40×24 尺寸）
- `src/components/DesktopShell.tsx`（pane 关闭图标）

## 第十五轮：确认弹窗 / composer 阴影时机 / 工具栏加号图标（3 项评论）

评论：确认弹窗「不应该出现背景色」「整个弹窗的规范参考项目中的弹窗进行调整」、composer「输入激活后在输入框出 shadow，不激活时背景与输入框都不出 shadow」、toolbar「图标不对」。

### 变更点清单

| #   | 对象                                  | 修复前                                                                    | 修复后（权威依据）                                                                                                                                |
| --- | ------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 确认弹窗遮罩 `.confirmation-dialog`   | `panel-background` / 桌面端 5% scrim                                      | `transparent`（codechat `approval-layer` 无背景，轻量浮层不遮上下文）                                                                             |
| 2   | 弹窗卡片 `.confirmation-dialog-inner` | pad 8 12 16 / maxW 640 / 边框 widget-border / 影 0 12 40 36% / 深 #1F1F1F | pad 16 / maxW 768 / 边框 `#E4E7ED`（浅）/ 影 `0 18px 48px rgb(31 35 41/18%)`（codechat `--cc-shadow-approval`）/ 深 #27292B + 12% 白边框 + 40% 影 |
| 3   | 弹窗标题 `.confirmation-title`        | 13px / 600                                                                | 16px / 600 / lh32（codechat `approval-header h2` = `--cc-font-size-lg` 16px）                                                                     |
| 4   | command / mcp 参数块                  | bg code-block / r4 / pad 6 10                                             | bg `#F7F8FA` / r8 / pad 12（codechat `approval-command` = `--cc-bg-code` + `--cc-radius-md`；深色 #27292B）                                       |
| 5   | 弹窗动作按钮 `.confirmation-btn`      | r8                                                                        | r6（codechat `--cc-radius-sm`）                                                                                                                   |
| 6   | composer 卡片 resting 阴影            | light 常驻 `0 8px 24px 6%`（第八轮按 Figma drop(0 8 24) 弱化）            | 移除 —— 不激活时无阴影；仅 `:focus-within` 出 `0 0 12px 12%` 柔影（skill 契约：composer flat at rest, gains shadow while textarea owns focus）    |
| 7   | workdir 灰条阴影 `.input-workdir-row` | 常驻 `0 8px 24px 6%`                                                      | 移除（背景常态无影）                                                                                                                              |
| 8   | toolbar「+」添加图标 `PlusIcon`       | 自绘 13×13 细加号（16×16 盒，笔画 1px）                                   | Figma `composer-add`（20×20 全幅加号，笔画 ~1.7px，codechat 同款）                                                                                |

### 验证结果（Playwright 探针实测，light/dark）

| 项                                  | 实测                                    | 期望 |
| ----------------------------------- | --------------------------------------- | ---- |
| 遮罩背景（light/dark）              | transparent                             | ✓    |
| 浅色卡片 bg/边框/阴影/pad/maxW      | #FFF / #E4E7ED / 18% 18×48 / 16 / 768   | ✓    |
| 深色卡片 bg/边框/阴影               | #27292B / 12% 白 / 40% 18×48            | ✓    |
| 标题 16/600/32                      | ✓                                       | ✓    |
| command 浅/深 bg、r8、pad12         | #F7F8FA / #27292B                       | ✓    |
| 按钮 r6                             | ✓                                       | ✓    |
| 未聚焦 input-content / workdir 阴影 | none / none                             | ✓    |
| 聚焦 input-content 阴影             | `0 0 12px 12%`（focus-within 真实点击） | ✓    |
| toolbar「+」20×20 Figma 形状        | ✓                                       | ✓    |
| compile                             | 通过                                    | ✓    |

### 实现文件

- `src/styles/host-desktop.css`（遮罩透明 + 第十五轮弹窗规格段 + 移除两处 resting 阴影）
- `src/components/HeaderIcons.tsx`（`PlusIcon` 换 Figma composer-add 形状）

## 第十六轮：面板切换菜单项间距 / 深色 timeline 节点白圈（2 项评论）

评论：panel-toggle-menu-item「预览⇧⌘P」检查选项内边距；timeline-row 运行状态「深色背景下不应该是白色的圈」。

### 变更点清单

| #   | 对象                             | 修复前                                     | 修复后（权威依据）                                                                                                                                      |
| --- | -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `.panel-toggle-menu-shortcut`    | label↔快捷键间距 8px                      | 最小 16px（codechat `workspace-header-menu-item` `gap: 16px`；wave 有 16px 选中勾占位，label flex:1 已右对齐快捷键，shortcut 补 8px margin-left = 8+8） |
| 2   | `.timeline-row::before` 深色描边 | 2px `#FFFFFF` 白描边（深色底上呈白圈突兀） | `#191A1B`（深色会话底同色描边，节点呈纯绿点；浅色白描边与白底融合保留）                                                                                 |

### 验证结果（Playwright 探针实测）

| 项                   | 实测                 | 期望 |
| -------------------- | -------------------- | ---- |
| label↔快捷键间距    | 16px（真实点击菜单） | ✓    |
| 深色节点描边         | `rgb(25,26,27)`      | ✓    |
| 浅色节点描边（回归） | `rgb(255,255,255)`   | ✓    |
| compile              | 通过                 | ✓    |

### 实现文件

- `src/styles/host-desktop.css`（timeline 深色描边 + panel-toggle shortcut 间距）

## 第十七轮：灰条触发器箭头方向/位置 / worktree 复选框样式（3 项评论）

评论：host-trigger「本地」下拉箭头方向错了；workdir-trigger「main」下拉箭头位置不对；worktree 复选框「参考其他选项的样式延展」。

### 变更点清单

| #   | 对象                                                                        | 修复前                                                                                      | 修复后（权威依据）                                                                                                                                                      |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `.desktop-host-caret` / `.desktop-workdir-caret`（本地/CC02/main 三个箭头） | 未旋转（朝上 ⌃，方向与 Figma 相反）；展开时不翻转                                           | `rotate(180deg)`（收起朝下 ⌄，codechat `picker-chevron` 默认旋转同值）；`aria-expanded="true"` 时 `transform: none`（展开朝上 ⌃，codechat `.is-open` 同值）+ 0.15s 过渡 |
| 2   | branch trigger「main」箭头                                                  | `codicon-chevron-down`（16px 字体被 CSS 压成 8×5 占位，视觉间距 16px 且方向与其他两个相反） | 换 `PermCaretIcon`（8×5 svg，与其他触发器同款），间距回到 6px；方向随统一规则旋转                                                                                       |
| 3   | `.desktop-worktree-checkbox`                                                | 无 padding/无 min-height/12px/无 hover（原生 checkbox 直接放入灰条，明显矮小）              | 参考同灰条选项（codechat `context-picker` 规格）延展：min-height 32 / pad 0 6 / r8 / 14px / hover 灰底 #EEF0F3（深色 8% 白）                                            |

### 验证结果（Playwright 探针 + 截图实测）

| 项                              | 实测                                           | 期望 |
| ------------------------------- | ---------------------------------------------- | ---- |
| 三个 caret 收起 transform       | `matrix(-1,0,0,-1)` = rotate(180deg)（统一 ⌄） | ✓    |
| main 与 CC02 箭头间距           | 均 6px                                         | ✓    |
| 展开态箭头（过渡后）            | `transform: none`（⌃）                         | ✓    |
| worktree checkbox minH/pad/r/fs | 32 / 0 6 / 8 / 14px                            | ✓    |
| compile                         | 通过                                           | ✓    |

### 实现文件

- `src/styles/host-desktop.css`（caret 旋转 + 展开翻转 + checkbox 样式）
- `src/components/DesktopWorktreeControls.tsx`（branch 箭头 codicon → PermCaretIcon）

## 第十八轮：预览面板工具栏图标/地址栏字号/背景色（1 项评论）

评论：`div.preview-pane-toolbar`「http://localhost:8899/」图标不对，输入区域字号，背景色不对。

### 变更点清单

| #   | 对象                                         | 修复前                                                                      | 修复后（权威依据 = 原型 InspectorPanel.vue + global.css）                                                                                                                                                                                                                                    |
| --- | -------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 工具栏按钮图标（拾取/刷新/浏览器/全屏/关闭） | codicon 字体图标（inspect/refresh/link-external/screen-full/close）         | Figma 导出 SVG（codechat `src/assets/figma/` 直接导出，fill 改 currentColor 适配深色）：inspector-cursor / refresh / open-browser / maximize·unmaximize；关闭复用 wave CloseIcon。新增 HeaderIcons 组件：InspectorCursorIcon / RefreshIcon / OpenBrowserIcon / MaximizeIcon / UnmaximizeIcon |
| 2   | 地址栏（显示态 span + 编辑态 input）字号     | 12px                                                                        | 14px / line-height 22（--cc-font-size-md）；显示态 span 与编辑态 input 同为 26px 高、pad 0 8px、r8、浅灰底 → 两态视觉一致无跳动（codechat 地址栏常显输入框）                                                                                                                                 |
| 3   | 地址栏/工具栏背景色                          | 工具栏继承 aside 侧栏背景 #F7F8FB；地址输入框 vscode-input 背景（无浅灰底） | 工具栏 44px 高 / pad 0 12 / gap 8 / 白底（深 #27292B）/ 底分隔线 #EBEEF5（深 12% 白）；地址栏浅灰底 #F0F2F5（深 6% 白）r8 无边框；placeholder #6C7076（深 #8B8F95）                                                                                                                          |
| 4   | 工具栏按钮尺寸/颜色                          | padding 4px 自适应、vscode foreground                                       | 24×24（figma-icon-button）/ r4 / 图标 #565A60（深 #9A9EA5）/ hover #EEF0F3（深 8% 白）/ 拾取 active #E7E9ED（深 12% 白）+ 文字转深                                                                                                                                                           |

### 验证结果（Playwright 探针 + 截图实测）

| 项                                | 实测                                                                                   | 期望 |
| --------------------------------- | -------------------------------------------------------------------------------------- | ---- |
| 工具栏高/pad/gap                  | 45（44+1 边框）/ 0 12 / 8                                                              | ✓    |
| 工具栏背景 light/dark             | #FFF / #27292B                                                                         | ✓    |
| 地址输入框 14px/26px/r8/无边框    | 14/22、26、8px、0px none                                                               | ✓    |
| 输入框背景 light/dark             | #F0F2F5 / 6% 白（placeholder #6C7076 / #8B8F95）                                       | ✓    |
| 按钮 24×24、svg 16×16、无 codicon | 5 按钮均 24×24、svgW 16、codicon false                                                 | ✓    |
| 按钮色 light/dark / hover light   | #565A60 / #9A9EA5 / #EEF0F3（深 8% 白）                                                | ✓    |
| 拾取 active light/dark            | #E7E9ED / 12% 白（直接加类验证；浏览器 mock 无 webview preload，点击不激活属环境限制） | ✓    |
| 显示态地址栏浅灰圆角底板          | vision 复核：浅色清晰可见、深色低调自洽，与按钮组对齐良好                              | ✓    |
| compile                           | 通过                                                                                   | ✓    |

### 实现文件

- `src/components/HeaderIcons.tsx`（新增 5 个 Figma 导出图标：InspectorCursor/Refresh/OpenBrowser/Maximize/Unmaximize）
- `src/components/PreviewPane.tsx`（工具栏 5 按钮 codicon → SVG 图标）
- `src/styles/DesktopApp.css`（工具栏 44px/0 12/8、地址栏 26px/14px/r8 两态统一、按钮 24×24）
- `src/styles/host-desktop.css`（第十八轮段：工具栏/地址栏/按钮 light+dark 颜色）

## 第十九轮：侧边栏收起态 header leading（1 项评论）

评论：`button.header-button`「收起后图标不对，这里还应该保留个新对话的图标，和后面的标题之间也应该有个分割线」。

### 变更点清单

| #   | 对象                   | 修复前                                                   | 修复后（权威依据 = 原型 WorkspaceHeader.vue + TaskSidebar.vue）                                                                                                                            |
| --- | ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 展开侧边栏按钮图标     | CollapseIcon（外框+左条，无方向指示）                    | Figma `sidebar-expand.svg`（外框 + 朝右箭头 →，表示向左侧展开）；新增 HeaderIcons `SidebarExpandIcon`。侧栏内收起按钮保持 sidebar-collapse（外框+左条）—— 方向语义区分：收起朝左、展开朝右 |
| 2   | 收起态缺少新对话按钮   | desktop 下 `hideSessionButtons` 隐藏全部 header 会话按钮 | 收起态 leading = 展开按钮 + 新对话按钮（NewSessionIcon，pane 用各自 handleClearChat + isStreaming 禁用）+ 分割线（对齐 codechat `workspace-header-start` 收起分支）；展开态无此组          |
| 3   | 按钮组与标题间无分割线 | 无                                                       | `header-collapsed-divider` 1px×16px / margin 0 8px（codechat workspace-header-divider 同值）；浅色 #DCDEE6（--cc-border），深色 12% 白沿用 wave 边框约定                                   |

### 验证结果（Playwright 探针 + 截图实测）

| 项                          | 实测                                                       | 期望 |
| --------------------------- | ---------------------------------------------------------- | ---- |
| 收起态 leading 顺序         | expand → new-session → divider → title → buttons           | ✓    |
| 展开按钮图标                | svg 2 paths（外框+箭头），首 path = sidebar-expand 箭头    | ✓    |
| 新对话按钮                  | 22×22、aria-label「新建对话」；真实点击 → 标题变「新对话」 | ✓    |
| divider 1px×16px light/dark | #DCDEE6 / rgba(255,255,255,0.12)                           | ✓    |
| 展开态回归                  | 无 expand/new-session/divider，sidebar 显示                | ✓    |
| 深色对比度                  | vision 复核：图标/分割线清晰，无变黑消失                   | ✓    |
| compile                     | 通过                                                       | ✓    |

### 实现文件

- `src/components/HeaderIcons.tsx`（新增 SidebarExpandIcon = sidebar-expand.svg 外框+右箭头）
- `src/components/ChatApp.tsx`（SidebarExpandButton 换图标；collapsedLeading = 展开+新对话+分割线，root/pane 共用）
- `src/styles/ChatHeader.css`（.header-collapsed-divider 布局 1px×16px margin 0 8px）
- `src/styles/host-desktop.css`（第十九轮段：divider 浅 #DCDEE6 / 深 12% 白）

## 第二十轮：权限模式按钮（1 项评论）

评论：`button.permission-mode-select.mode-default`「修改前询问」——「这里不要箭头了，是固定宽度，检查下拉菜单的选中项问题，和字体颜色的统一性」。

### 变更点清单

| #   | 对象                      | 修复前                                                              | 修复后（权威依据 = 原型 ComposerBox.vue permission-button + element-plus.css el-dropdown-menu\_\_item）                                                                                                                                       |
| --- | ------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 权限按钮宽度/布局         | 内容自适应 padding、带 caret 箭头                                   | 固定 112px（codechat permission-button 固定宽规格）/ min-height 32 / pad 0 / 内容居中（justify-content center / gap 6）盒模型修正 box-sizing: border-box；caret 移除（`.permission-mode-caret { display: none }`，JSX 保留元素不影响 IDE 端） |
| 2   | 按钮/非选中项字体颜色统一 | 依赖 vscode 语义 token，主题间不一致                                | 固定字体色：按钮 resting light #565A60 / dark #9A9EA5（--cc-text-regular / 深色映射惯例）；非选中菜单项同色统一                                                                                                                               |
| 3   | 下拉菜单选中项无视觉      | selected 只有 vscode activeSelection 依赖，desktop 下近透明无选中感 | selected = #E7E9ED 底 + #1F2329 字（light，element-plus is-active 同值）/ 12% 白底 + #fff（dark）；selected:hover 保持 pressed 不漂回 hover                                                                                                   |
| 4   | 菜单项字重                | 默认 400                                                            | font-weight 500（el-dropdown-menu\_\_item --cc-font-weight-medium 统一）                                                                                                                                                                      |

### 验证结果（Playwright 探针 + 截图实测）

| 项                         | 实测                                                                  | 期望 |
| -------------------------- | --------------------------------------------------------------------- | ---- |
| 按钮 112×32/14px/居中      | width 112、height 32、font-size 14、text-align center、pad 0          | ✓    |
| caret 隐藏                 | display none（JSX 元素保留，IDE 端不受影响）                          | ✓    |
| 按钮 resting 色 light/dark | #565A60 / #9A9EA5（移开鼠标后实测，此前误读为 hover 态 #1F2329/#fff） | ✓    |
| 非选中项色 light/dark      | #565A60 / #9A9EA5（与按钮同色，字体颜色统一）                         | ✓    |
| 菜单项 14px/字重 500       | 14/500                                                                | ✓    |
| 选中项 light/dark          | #E7E9ED 底+#1F2329 字 / 12% 白底+#fff                                 | ✓    |
| hover（真实鼠标）light     | 非选中项 #EEF0F3 底 + #1F2329 字                                      | ✓    |
| hover（真实鼠标）dark      | 非选中项 rgba(255,255,255,0.08) 底 + #fff                             | ✓    |
| danger 项（绕过权限）      | 红 #F4655C（light #E5484D），hover 红色系底                           | ✓    |
| compile                    | 通过                                                                  | ✓    |

### 实现文件

- `src/styles/host-desktop.css`（第二十轮段：权限按钮 112px 固定/居中/无 caret；菜单项 500 字重、非选中同色、selected 浅 #E7E9ED / 深 12% 白 + hover 保持 pressed）

## 第二十一轮：全局滚动条统一（1 项评论）

评论：`#messagesContainer`「滚动条的样式参考项目，所有滚动条要保持统一，不同状态是分不同色值的，默认状态比现在更浅」。

### 变更点清单

| #   | 对象                      | 修复前                                                                                              | 修复后（权威依据 = Figma 5809:55691 / codechat global.css 2304-2351）                                                 |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | 所有滚动容器 thumb 默认色 | vscode-scrollbarSlider token：light `rgba(100,100,100,0.75)` / dark `rgba(121,121,121,0.4)`（过深） | 8% 黑 `rgb(0 0 0 / 8%)`（--cc-fill-scrollbar）/ 深色 8% 白 `rgb(255 255 255 / 8%)` —— 默认态显著变浅                  |
| 2   | thumb hover               | vscode-scrollbarSlider-hoverBackground（无桌面端定制）                                              | 24% `rgb(0 0 0 / 24%)`（--cc-fill-scrollbar-container-hover）/ 深色 24% 白                                            |
| 3   | thumb active（拖动）      | vscode-scrollbarSlider-activeBackground                                                             | 50% `rgb(0 0 0 / 50%)`（--cc-fill-scrollbar-hover）/ 深色 50% 白                                                      |
| 4   | 轨道/宽度/圆角            | 16px 轨道 8px pill 已一致，但 DiffViewer 特化 10px 轨道 + `--vscode-scrollbar-shadow` 深色 track    | 全桌面端统一 16px 轨道 / 8px pill（4px 透明边 + padding-box）/ 轨道恒透明；DiffViewer 特化被同 specificity 后加载覆盖 |

### 验证结果（Playwright 探针 + 真实鼠标）

| 项                           | 实测                                                                | 期望 |
| ---------------------------- | ------------------------------------------------------------------- | ---- |
| 默认色 light/dark            | `rgba(0,0,0,0.08)` / `rgba(255,255,255,0.08)`（基线 75% 灰/40% 灰） | ✓    |
| hover（真实鼠标在 thumb 上） | light `rgba(0,0,0,0.24)` / dark `rgba(255,255,255,0.24)`            | ✓    |
| active（按住 thumb 拖动）    | dark `rgba(255,255,255,0.5)`（light 规则同构 50% 黑）               | ✓    |
| 轨道透明 / 16px / 8px 圆角   | transparent / 16 / 8px + 4px 透明边 + padding-box                   | ✓    |
| DiffViewer 统一              | 16px 轨道、透明 track、8% thumb（不再 10px/阴影 track）             | ✓    |
| thumb 真实渲染可交互         | 拖动 thumb 150px → scrollTop 0→32（滚动条渲染且可拖动）             | ✓    |
| compile                      | 通过                                                                | ✓    |

注：headless 截图（headless shell 与完整 Chrome headless）均不显示滚动条像素，属 headless 合成限制；CSS 计算值 + 伪类 :hover/:active 匹配 + 真实拖动交互均验证滚动条已渲染，Electron 真机不受影响。

### 实现文件

- `src/styles/host-desktop.css`（第二十一轮段：`[data-host="desktop"] ::-webkit-scrollbar*` 三态 + 深色映射）

### 第二十一轮补充（用户反馈「还是不太对」：三态触发范围修正）

用户规则：「正常是最浅，hover 到滚动区域，hover 到滚动条上和操作滚动条时最深」—— 对应 codechat 三态触发范围：**容器 hover（鼠标在滚动区域内任意位置）24%**，而非上一版实现的 thumb hover 才 24%。

| #   | 对象           | 上版（已废弃）                                                | 修正后（codechat main.ts 同款机制）                                                                                                                                                                                     |
| --- | -------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 三态触发机制   | 纯 CSS `::-webkit-scrollbar-thumb:hover`（仅 thumb 上才 24%） | **mousemove 委托 + CSS 变量驱动**：鼠标在滚动容器内（非轨道）→ inline `--cc-fill-scrollbar-active: 24%`；在轨道区（右缘 20px 内）→ 50%；离开容器 → 清除回落 8%                                                          |
| 2   | JS 位置        | —                                                             | `src/index.tsx`（产品入口，仅 `waveHostType === "desktop"` 注册；preview-entry.tsx 同款仅本地）                                                                                                                         |
| 3   | CSS 变量作用域 | —                                                             | 新增 `[data-host="desktop"] * { --cc-fill-scrollbar-active: var(--cc-fill-scrollbar) }` 通配声明 —— **阻断祖先 inline 变量继承**（否则鼠标在全局滚动层时所有子孙滚动容器 thumb 被迫变深）；JS inline 优先级最高仍可覆盖 |
| 4   | 拖动兜底       | `:active` 50%                                                 | 保留 `[data-host="desktop"] ::-webkit-scrollbar-thumb:active { background-color: var(--cc-fill-scrollbar-hover) }`（拖动中 50%，JS 委托同时覆盖轨道区）                                                                 |

补充验证（探针 + 真实鼠标，light/dark）：

| 项                                   | 实测                                                   | 期望 |
| ------------------------------------ | ------------------------------------------------------ | ---- |
| 默认（鼠标离开滚动容器）             | light 8% 黑 / dark 8% 白（inline 清除）                | ✓    |
| 鼠标在滚动区域内（非轨道）           | 24%（inline container-hover）                          | ✓    |
| 鼠标在轨道区（右缘 20px 内）         | 50%（inline hover）                                    | ✓    |
| 拖动 thumb（:active 兜底）           | dark 50% 白                                            | ✓    |
| 双滚动容器互不干扰（A/B 注入元素）   | 鼠标在 A → A 24%/B 8%；移 B → A 8%/B 24%；离开 → 全 8% | ✓    |
| 修复前的继承 bug（鼠标在全局滚动层） | 消息区 thumb 被迫 24% → 修复后恢复 8%                  | ✓    |
| compile / type-check                 | 通过                                                   | ✓    |

### 实现文件（补充）

- `src/index.tsx`（mousemove 委托：滚动容器查找 + overTrack 判定 + inline 变量设置，desktop only）
- `src/styles/host-desktop.css`（三态变量化：--cc-fill-scrollbar{-container-hover,-hover,-active}；通配声明阻断继承；:active 兜底）
- `prototype/preview-entry.tsx`（同款委托，仅本地预览验证，不提交）

## 第二十二轮：确认弹窗对齐 codechat approval-dialog（1 项评论）

评论：`div.confirmation-dialog`「executeBash npm install」——「多了灰色的背景色、按钮布局参考项目中的弹窗、关闭按钮错位，检查间距边距」。

### 变更点清单

| #   | 对象             | 修复前                                                                                                                  | 修复后（权威依据 = 原型 ApprovalDialog.vue + global.css approval-\* 段）                                                                                                                                                                  |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 弹窗外围灰色背景 | 弹窗容器 `input-area-container--confirm` 继承桌面统一 padding 16 → dark 下透出容器底 #191A1B 深灰，围住卡片形成一圈灰缝 | 弹窗模式下容器 padding 归零（`[data-host="desktop"] .input-area-container--confirm { padding: 0 }`）→ 卡片贴满，外围灰缝消失（codechat approval-layer 无背景、弹窗悬浮）                                                                  |
| 2   | 按钮布局         | 横排一行右对齐（flex-end wrap）                                                                                         | **竖排全宽**（codechat approval-actions：flex-direction column / gap 8 / margin-top 16）；按钮 width 100% / min-height 32 / pad 0 12 / 字重 500 / r6。DOM 顺序 = 视觉顺序：提供反馈(ghost) → 自动类(secondary) → 批准并继续(primary) 在底 |
| 3   | 按钮三态配色     | apply 炭黑 ✓；auto 用 vscode secondary token；feedback 文本型 24px                                                      | secondary（auto/reject）：light #f0f2f5 底 + #ebeef5 边 + #1f2329 字（dark 6% 白/12% 白/#E6E6E6）；ghost（feedback）：透明 + #565A60（dark #9A9EA5），hover #eef0f3（dark 8% 白）；apply 保持 token（light #1f2329 / dark #3d424a）白字   |
| 4   | 关闭按钮错位     | absolute top 8 / right 12（base 12px padding 时代旧值）→ 偏上偏外，与标题行不对齐                                       | top 22 / right 16（= 卡片 padding 16；标题 16px/lh32 → 行中心 32px，按钮 20×20 → 22）→ close 中心 y 与标题行中心完全重合（实测 799=799）、右缘与内容右端对齐（gap 17px）；hover 色统一 #eef0f3 / 8% 白                                    |
| 5   | 间距节奏         | header 内 gap 6px                                                                                                       | 8px（codechat 8/12/16 节奏：卡片 pad 16、title→command 8、command→按钮 16）                                                                                                                                                               |

### 验证结果（Playwright 探针 + 截图实测 + vision 复核）

| 项                     | 实测                                                                                                     | 期望 |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ---- |
| 弹窗容器 padding       | 0px（原 16px），dark 灰缝消失                                                                            | ✓    |
| 按钮竖排全宽           | flex-direction column / gap 8 / margin-top 16 / 全宽 734×32                                              | ✓    |
| 三态配色 light/dark    | feedback 透明 #565A60/#9A9EA5；auto #f0f2f5·#ebeef5·#1f2329 / 6%·12% 白·#E6E6E6；apply 炭黑/#3d424a 白字 | ✓    |
| 关闭按钮对齐           | top 22/right 16；closeCenterY 799 = titleCenterY 799；右 gap 17                                          | ✓    |
| header 间距            | 8px                                                                                                      | ✓    |
| vision 复核 light/dark | 灰缝消失、竖排均匀、配色正确、× 同行居中、间距协调                                                       | ✓    |
| compile / type-check   | 通过                                                                                                     | ✓    |

### 实现文件

- `src/styles/host-desktop.css`（第二十二轮段：弹窗容器 padding 0、actions 竖排全宽、按钮三态、close 定位、header 间距）

## 第二十三轮：sticky 用户消息对齐普通用户气泡（1 项评论）

评论：`div.sticky-user-message`「帮我修复登录页的样式错乱问题…」——「悬浮起来以后缺少左边边距，希望悬浮起来以后文字粗细保持不变」。

### 变更点清单

| #   | 对象           | 修复前                                                                                                                                                                       | 修复后                                                                                                 |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | 悬浮卡片左边距 | `.sticky-user-wrapper` margin-left/right **-10px**（把卡片拉伸到容器 border box）→ 卡片左缘贴容器左缘（实测 x=730 = 容器 x），比消息内容左缘（padding 10 内 x=740）靠外 10px | margin-left/right 归零 → 卡片左缘回到容器 padding 10px 内（实测 x=740 = 消息行左缘），与普通消息左对齐 |
| 2   | 悬浮文字字重   | `.sticky-user-content` font-weight 400（继承默认）→ 悬浮后比普通用户气泡 14px/**500** 变细                                                                                   | 500（与普通用户气泡一致，悬浮前后文字粗细保持不变；字号 14px 已一致）                                  |

### 验证结果（Playwright 探针 + 截图实测）

| 项                   | 实测                                                                     | 期望 |
| -------------------- | ------------------------------------------------------------------------ | ---- |
| 卡片左缘 vs 内容左缘 | 740 = 740（容器 padding 10 内对齐）                                      | ✓    |
| wrapper margin       | 0px（原 0 -10px）                                                        | ✓    |
| sticky 字重 vs 气泡  | 500 = 500（原 400 vs 500）                                               | ✓    |
| 卡片宽度             | 780（容器 content box 全宽，滚动内容覆盖完整）                           | ✓    |
| vision 复核          | 左边距与内容行对齐；字重视觉目测偏粗系深色渲染观感，computed 值 500 权威 | ✓    |
| compile / type-check | 通过                                                                     | ✓    |

### 实现文件

- `src/styles/host-desktop.css`（第二十三轮段：sticky wrapper margin 归零 + sticky content 字重 500）
