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

评论：`div.preview-pane-toolbar`「`http://localhost:8899/`」图标不对，输入区域字号，背景色不对。

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

## 第二十四轮：收起态 header 图标与间距（2 项评论）

评论①：`svg`（收起态新对话按钮）「检查和设计稿中图标的一致性，包括收起时的新对话图标」；
评论②：`button.header-button`「检查图标和其他地方的间距问题」。

### 变更点清单

| #   | 对象                     | 修复前                                                                     | 修复后                                                                                                               |
| --- | ------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | NewSessionIcon 加号 path | 直角小加号（`M11.9518 10.8213H14.4781…`，笔画 1px 无圆角，跨度 5.88×6.02） | 替换为 Figma new-chat-header.svg 权威圆角加号（`M11.4518 8.15918C11.8384…`，C 曲线圆角、笔画 1.4px、跨度 6.28×6.42） |
| 2   | NewSessionIcon 气泡 path | 同源异构气泡 path（坐标偏移 ~0.1）                                         | 替换为 Figma 同款气泡 path（与加号同源，fill-rule evenodd）                                                          |
| 3   | 收起态按钮间距           | 两个按钮间 **0px**（leading 是 fragment 无容器，.chat-header 无 gap）      | 包一层 `.header-collapsed-leading`（flex gap 8 align-center）→ 按钮间距 8px（实测 48-40=8）                          |
| 4   | 收起态按钮尺寸           | 22×22（继承 base .header-button）                                          | **24×24 + r6**（对齐 codechat figma-icon-button）                                                                    |
| 5   | header 左右 padding      | 0 12px                                                                     | 保持 12px（Figma 权威；codechat 0 16px 与 Figma 冲突，按既有结论勿改）                                               |
| 6   | 收起态按钮 hover 背景    | base `--vscode-toolbar-hoverBackground`（VS Code 蓝灰）                    | `--cc-fill-hover`：浅 #EEF0F3 / 深 rgba(255,255,255,0.08)（对齐 codechat figma-icon-button:hover）                   |
| 7   | divider 间距机制         | margin 0 8px（手写双 8px）                                                 | margin 0，由容器 gap 8 提供两侧 8px（与 codechat workspace-header-start 同构）                                       |

### 验证结果（Playwright 探针 + 截图实测）

| 项                    | 实测                                                                | 期望 |
| --------------------- | ------------------------------------------------------------------- | ---- |
| 收起态按钮            | 2 个，24×24、r6                                                     | ✓    |
| 按钮间距              | 8px（rect: x 16 → 48）                                              | ✓    |
| leading 容器          | flex / gap 8px / align-items center                                 | ✓    |
| divider               | 1×16、margin 0                                                      | ✓    |
| chat-header padding   | left/right 12px（保持 Figma 权威值；不随 codechat 改 16px）         | ✓    |
| 加号 path             | 含 `C11.8384` 圆角曲线（直角 path 已移除）                          | ✓    |
| hover 背景 light/dark | rgb(238,240,243) = #EEF0F3 / rgba(255,255,255,0.08)（真实鼠标实测） | ✓    |
| vision 复核           | 两按钮形状正确（外框+右箭头 / 气泡+圆角加号）、间距均匀、对比度良好 | ✓    |
| smoke-ui / type-check | 无 JS 错误 / 通过                                                   | ✓    |

注：1px #DCDEE6 分割线在浅底上细不可见属设计预期（codechat --cc-border 同款）；本页探针改用
`setAttribute` 设置主题（`dataset.theme` 赋值会被 vite HMR 偶发重置）。

### 实现文件

- `src/components/HeaderIcons.tsx`（NewSessionIcon 双 path 替换为 Figma 权威版）
- `src/components/ChatApp.tsx`（collapsedLeading 包 `.header-collapsed-leading` 容器）
- `src/styles/ChatHeader.css`（新增 leading 容器 flex gap 8；divider margin 归零）
- `src/styles/host-desktop.css`（第二十四轮段：收起态按钮 24×24/r6/hover 双主题；chat-header padding 保持 12px）

## 第二十五轮：panel-toggle 菜单选中态去对号（1 项评论）

评论：`div.panel-toggle-menu-item`「预览⇧⌘P」——「参考下拉菜单的选中状态，不要对号，下拉菜单需要符合规范」。

### 变更点清单

| #   | 对象             | 修复前                                          | 修复后                                                                                                        |
| --- | ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | 选中态指示       | codicon-check 对号（16px 占位，选中时 visible） | 移除对号元素，选中项改用背景高亮（对齐 codechat workspace-header-menu-item.active）                           |
| 2   | 选中态样式 light | 无背景，仅对号                                  | 背景 #E7E9ED + 文字 #1F2329（`panel-toggle-menu-item--active`，active:hover/focus 保持 pressed 不漂回 hover） |
| 3   | 选中态样式 dark  | 无背景，仅对号                                  | 背景 rgba(255,255,255,0.12) + 白字                                                                            |
| 4   | base 死代码      | `.panel-toggle-menu-check` / `--on`（对号控制） | 删除（TSX 不再渲染对号）                                                                                      |

说明：菜单面板/菜单项外观第 13 轮已统一为 codechat 规格（白底 r12 柔影、item 32px/14px/500/r6/hover #EEF0F3），本轮仅补选中态；role="checkbox"/aria-checked 保留（无障碍语义）。label flex:1 + shortcut margin-left 8 维持 16px 最小间距（codechat gap 16）。

### 验证结果（Playwright 探针 + 截图实测）

| 项                        | 实测                                                   | 期望 |
| ------------------------- | ------------------------------------------------------ | ---- |
| 对号元素                  | 0（无 .panel-toggle-menu-check / .codicon-check）      | ✓    |
| 选中项 light              | #E7E9ED 底 + #1F2329 字（rgb(231,233,237)/(31,35,41)） | ✓    |
| 选中项 dark               | rgba(255,255,255,0.12) 底 + #fff 字                    | ✓    |
| active:hover 保持 pressed | light #E7E9ED + #1F2329（真实鼠标实测）                | ✓    |
| 未选中项                  | 透明底                                                 | ✓    |
| 菜单项                    | 32px 高 / shortcut margin-left 8px                     | ✓    |
| smoke-ui / type-check     | 无 JS 错误 / 通过                                      | ✓    |

注：mock 初始无面板开启（checked=[]），探针需先点击菜单项制造选中态再断言；
双 pane 下 1440px 宽 chat-main < 680px 会拒绝开面板 → 探针用 2000px 宽（同第 16 轮坑）。

### 实现文件

- `src/components/PanelToggleMenu.tsx`（移除对号 `<i>`，选中项加 `panel-toggle-menu-item--active` 类）
- `src/styles/PanelToggleMenu.css`（删除 check 对号死代码）
- `src/styles/host-desktop.css`（第二十五轮段：浅/深选中态 + active:hover 保持 pressed）

## 第二十六轮：消息内链接统一（颜色 + hover 下划线）（1 项评论）

评论：`span.write-tool-path`「src/styles/login.css」——「检查所有链接字体颜色，hover后出现下划线」。

### 变更点清单

| #   | 对象                    | 修复前                                                                                                                                           | 修复后                                                                                         |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1   | 链接颜色统一（浅色）    | write-tool-path/bash 输出 #2F5EDB（--cc-text-link）✓，但 **markdown 链接仍是 VS Code 蓝 #0069cc**（theme-base-light token，无 desktop override） | 全部 #2F5EDB（Figma --cc-text-link）：新增 `.markdown-content a` 覆盖                          |
| 2   | 链接颜色统一（深色）    | write-tool-path **#9A9EA5（普通次级灰，不像链接）**；markdown 链接 #4daafc；bash 链接 #4daafc                                                    | write-tool-path/markdown 链接统一 #4daafc（theme-base-dark 链接 token，深底亮蓝可读）          |
| 3   | hover 下划线            | write-tool-path **hover 无任何反馈**（常态 dotted 下划线被 desktop 移除后裸奔）；bash 链接 hover 仅变色无下划线                                  | write-tool-path / bash 链接 hover `text-decoration: underline`（真实鼠标验证）                 |
| 4   | markdown 链接下划线机制 | base 用 `border-bottom` 伪下划线 + hover 变色（VS Code 蓝）                                                                                      | desktop 下 border-bottom 移除，统一用 `text-decoration: underline`，hover 保持链接色（不变色） |
| 5   | write-tool-path 常态    | base `underline dotted` 常驻虚线（desktop 已移除）                                                                                               | 保持无下划线（Figma 规范），仅 hover 出现                                                      |

### 验证结果（Playwright 探针 + 截图实测）

| 项                         | 实测                                             | 期望 |
| -------------------------- | ------------------------------------------------ | ---- |
| write-tool-path light/dark | #2F5EDB / #4daafc，常态无下划线，13px Menlo      | ✓    |
| write-tool-path hover      | #2F5EDB + underline（真实鼠标）                  | ✓    |
| markdown 链接 light/dark   | #2F5EDB / #4daafc，border-bottom 0，常态无下划线 | ✓    |
| markdown 链接 hover        | #2F5EDB + underline（真实鼠标，颜色不变）        | ✓    |
| bash 输出链接 hover        | #2F5EDB + underline（真实鼠标）                  | ✓    |
| smoke-ui / type-check      | 无 JS 错误 / 通过                                | ✓    |

### 实现文件

- `src/styles/host-desktop.css`（第二十六轮段：markdown a 颜色/下划线机制、dark 链接统一 #4daafc、write-tool-path/bash hover underline）

## 第二十七轮：预览头部背景（toolbar 深色去背景 / tab-bar 浅色补白底）（2 项评论）

评论①：`div.preview-pane-toolbar`「`http://localhost:8899/`」——「深色模式下这里不应该有背景色」。
评论②：`div.preview-tab-bar`「`localhost:8899`」——「浅色模式下这里不应该有背景色」。

### 背景：第 18 轮后头部状态与用户感知

第 18 轮按 codechat InspectorPanel.vue 把浅色 toolbar 改为白底 #FFF，但 tab-bar 保持透明（原型 pill tabs 设计），于是：

| 主题 | tab-bar（透明）      | toolbar（第 18 轮） | 用户感知                                              |
| ---- | -------------------- | ------------------- | ----------------------------------------------------- |
| 浅色 | 露出 pane 灰 #F7F8FB | 白 #FFF             | tab-bar 区域是灰色条带，与白色 toolbar 不连续 → 评论② |
| 深色 | 露出 pane 黑 #181818 | #27292B             | toolbar 比 pane 亮一档，成悬浮色块 → 评论①            |

Figma 对照（`13497-15325` 预览区展开帧，vision 复核渲染图）：头部标签栏+地址栏为连续浅灰带（约 #F5F6F8，≈ wave pane 背景）、选中标签为白色胶囊、URL 输入框为白色胶囊。wave 采用 codechat 白底方案后，用户以「头部连续无色带」为准。

### 变更点清单

| #   | 对象                         | 修复前                                       | 修复后                                                               |
| --- | ---------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| 1   | 浅色 `.preview-tab-bar`      | 透明（露出 pane 灰 #F7F8FB，被感知为背景色） | 白底 #FFFFFF + 底分隔线 #EBEEF5，与浅色 toolbar 连续成统一白色头部   |
| 2   | 深色 `.preview-pane-toolbar` | 背景 #27292B（比 pane #181818 亮一档）       | 背景 transparent，头部与 pane 底色融为一体                           |
| 3   | 深色 `.preview-tab-bar`      | 透明（已露 pane #181818）                    | 保持透明（无需改）                                                   |
| 4   | 浅色 `.preview-pane-toolbar` | 白 #FFF（第 18 轮）                          | 保持白 #FFF（与 tab-bar 白连续）                                     |
| 5   | 选中标签/URL 胶囊（两主题）  | light #F0F2F5 / dark 10%·6% 白               | 保持（白底上 #F0F2F5 灰胶囊、深底上亮档胶囊均清晰可见，vision 复核） |

### 验证结果（Playwright 探针 + 截图实测）

| 项                            | 实测                                                  | 期望 |
| ----------------------------- | ----------------------------------------------------- | ---- |
| 浅色 tab-bar 背景             | #FFFFFF（rgb(255,255,255)）                           | ✓    |
| 浅色 toolbar 背景             | #FFFFFF，与 tab-bar 连续                              | ✓    |
| 深色 tab-bar 背景             | 透明 rgba(0,0,0,0)（露出 pane #181818）               | ✓    |
| 深色 toolbar 背景             | 透明 rgba(0,0,0,0)（露出 pane #181818），不再有色块   | ✓    |
| 选中标签可见性（vision 复核） | light 浅灰胶囊 on 白、dark 亮一档胶囊 on 深底，均可辨 | ✓    |
| 头部整体（vision 复核）       | 浅色连续白、深色与 pane 融为一体，无灰色条带/突兀色块 | ✓    |
| smoke-ui / type-check         | 无 JS 错误 / 通过                                     | ✓    |

探针路径：mock sa-msg-8 的 localhost 链接点击 → PreviewPane 完整挂载（tab-bar 仅在 previewUrl 非空时渲染，ChatApp L2325）。

### 实现文件

- `src/styles/host-desktop.css`（第二十七轮段：浅色 `.preview-tab-bar` 白底 + 深色 `.preview-pane-toolbar` 透明）

## 第二十八轮：非预览面板标题去背景（1 项评论）

评论：`span.preview-pane-url`「计划」——「通过下拉菜单打开这里标题加粗，不应该有背景色」。

### 背景

`span.preview-pane-url` 类被 5 处复用：PreviewPane 地址栏（真 URL）+ 4 个面板标题（PlanPane「计划」/ FilePane 空态「文件」/ DiffPane「差异」/ TerminalPane「终端」）。第 18 轮为地址栏对齐 codechat `preview-address-input` 加了灰底胶囊（light #F0F2F5 / dark 6% 白），该胶囊被误套到面板标题上，标题呈「灰底标签」观感。

用户经 panel-toggle 下拉菜单「计划」项打开计划面板，评论标题「加粗 + 有背景色」。实测字重 400（未加粗，灰底胶囊观感误判为加粗），背景 #F0F2F5 / 6% 白为实。

### 变更点清单

| #   | 对象                                        | 修复前                       | 修复后                                                |
| --- | ------------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| 1   | `.plan-pane .preview-pane-url`「计划」      | 灰底胶囊 #F0F2F5（深 6% 白） | background: transparent（普通文字标题）               |
| 2   | `.file-pane .preview-pane-url`「文件」      | 同                           | 同（统一处理，避免逐面板评论）                        |
| 3   | `.diff-pane .preview-pane-url`「差异」      | 同                           | 同                                                    |
| 4   | `.terminal-pane .preview-pane-url`「终端」  | 同                           | 同                                                    |
| 5   | `.preview-pane .preview-pane-url`（真地址） | 灰底胶囊 #F0F2F5 / 6% 白     | **保留**（地址输入框有意样式，第 18 轮对齐 codechat） |
| 6   | 标题字重                                    | 400（无加粗规则）            | 保持 400（用户「加粗」为灰底胶囊观感误判，实测非粗）  |

### 验证结果（Playwright 探针 + 截图实测）

| 项                            | 实测                                                       | 期望 |
| ----------------------------- | ---------------------------------------------------------- | ---- |
| 计划标题背景 light/dark       | 均 transparent rgba(0,0,0,0)，字重 400                     | ✓    |
| 地址栏背景 light/dark（保留） | #F0F2F5 / rgba(255,255,255,0.06)                           | ✓    |
| 标题观感（vision 复核）       | 两主题均无背景胶囊、常规字重、垂直居中、与关闭按钮对齐良好 | ✓    |
| 工具栏行背景 light/dark       | 白 / pane 深色，标题直接落底                               | ✓    |
| smoke-ui / type-check         | 无 JS 错误 / 通过                                          | ✓    |

探针路径：panel-toggle 菜单「计划」项点击 → PlanPane 挂载；打开后需按 Escape 关闭菜单再截图（菜单浮层会遮挡/污染截图）。

### 实现文件

- `src/styles/host-desktop.css`（第二十八轮段：plan/file/diff/terminal 面板 `.preview-pane-url` 去背景）

## 第二十九轮：会话行更多按钮 + 菜单图标（1 项评论）

评论：`span.codicon.codicon-ellipsis`（会话行更多按钮）——「检查更多操作按钮尺寸，及更多按钮点开下拉菜单内部样式是否正确，包括图标，和下拉菜单规范」。

### 背景

侧边栏会话行「更多操作」按钮（`.desktop-session-more-btn`）为 18×18 codicon-ellipsis 字体图标；点开的下拉菜单（SessionItemMenu：并排打开 / 删除会话）面板与项尺寸第十三轮已统一（白底 r12 柔影 / 32px / 14px / 500 / gap 8 / 危险项 #D92D20），但**图标仍是 codicon 字体**（split-horizontal / trash），与 codechat 的 SVG 图标体系不符。

参考 codechat TaskSidebar.vue + global.css（element-plus.css task-row-more-popper）：按钮 24×24（task-row-more-btn）+ 图标 16×16（more.svg）；菜单项 `el-dropdown-menu__item` gap 8 / min-w 124 / min-h 32 / 14px / 500，图标 lucide Columns2/Trash2 `:size="15"`；按钮 hover `--cc-fill-pressed`。

### 变更点清单

| #   | 对象                         | 修复前                                                                  | 修复后                                                                      |
| --- | ---------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | 更多按钮尺寸                 | 18×18、r4、codicon-ellipsis 字体 14px                                   | **24×24**（对齐 task-row-more-btn）+ Figma more.svg 图标 16×16（MoreIcon）  |
| 2   | 更多按钮 hover               | `--vscode-toolbar-hoverBackground`（VS Code 蓝灰）                      | `--cc-fill-pressed`：light #E7E9ED / dark 12% 白                            |
| 3   | 菜单项「并排打开」图标       | codicon-split-horizontal（字体）                                        | **SplitIcon**（HeaderIcons 新增，codechat 同款 lucide columns-2，stroke 2） |
| 4   | 菜单项「删除会话」图标       | codicon-trash（字体）                                                   | **QueueTrashIcon**（Figma trash 复用）                                      |
| 5   | 菜单项图标尺寸               | codicon 字体 16px                                                       | SVG 15×15（对齐 el-dropdown-menu\_\_item svg `:size=15`）                   |
| 6   | 账户卡片更多按钮图标（顺带） | codicon-ellipsis（2 处：登录态/未登录态）                               | MoreIcon 16×16（同一 Figma 图标，按钮本身 32×32 保持）                      |
| 7   | 菜单面板/项规范              | 第十三轮已达标（白底 r12 柔影 / 32px / 14px / 500 / gap 8 / danger 红） | 保持（vision 复核确认）                                                     |

### 验证结果（Playwright 探针 + 截图实测）

| 项                      | 实测                                                                | 期望 |
| ----------------------- | ------------------------------------------------------------------- | ---- |
| 更多按钮尺寸            | 24×24、图标 16×16                                                   | ✓    |
| 按钮 hover light/dark   | #E7E9ED（rgb 231,233,237）/ rgba(255,255,255,0.12)（真实鼠标）      | ✓    |
| 菜单项图标              | 2 个 svg 均 15×15（desktop-session-menu-icon），无 codicon          | ✓    |
| 菜单面板 light/dark     | #FFF / #27292B、r12、pad 8、边框 #EBEEF5 / 12% 白                   | ✓    |
| 菜单项                  | 32px / 14px / 500，普通 #565A60 / #9A9EA5，danger #D92D20 / #F4655C | ✓    |
| 菜单观感（vision 复核） | 两主题图标清晰、颜色语义正确（普通灰/删除红）、尺寸协调、无错位溢出 | ✓    |
| type-check / smoke-ui   | 通过 / 无 JS 错误                                                   | ✓    |

### 实现文件

- `src/components/HeaderIcons.tsx`（新增 SplitIcon = lucide columns-2）
- `src/components/DesktopSidebar.tsx`（更多按钮 MoreIcon、菜单项 SplitIcon/QueueTrashIcon）
- `src/components/AccountCard.tsx`（2 处 more 按钮 codicon → MoreIcon）
- `src/styles/host-desktop.css`（第二十九轮段：按钮 24×24、hover pressed、菜单项 svg 15px）

## 第三十轮：确认弹窗「提供反馈」移到最下面（1 项评论）

评论：`button.confirmation-btn.confirmation-btn-feedback`「提供反馈」——「提供反馈应该放在最下面」。

### 背景

第二十二轮把确认弹窗按钮改为竖排全宽，当时 DOM 顺序为 提供反馈(ghost) → 自动类(secondary) → 批准并继续(primary)。用户反馈「提供反馈」应在最下面。参考 codechat ApprovalDialog.vue：`approval-actions` 内 DOM 顺序为 primary（批准并继续）→ secondary（自动类）→ ghost（提供反馈/取消）——ghost 弱按钮放最底部符合规范。

### 变更点清单

| #   | 对象              | 修复前                                           | 修复后                                                  |
| --- | ----------------- | ------------------------------------------------ | ------------------------------------------------------- |
| 1   | 按钮 DOM/视觉顺序 | 提供反馈(ghost) → 自动类(secondary) → 批准并继续 | 自动类 → 批准并继续(primary) → **提供反馈(ghost) 在底** |
| 2   | 提供反馈渲染条件  | Bash/Edit/Write/ExitPlanMode/mcp\_\_ 白名单      | 保持（仅移动位置，条件不变）                            |
| 3   | 按钮样式层级      | ghost 透明 / secondary 浅灰 / primary 实底       | 保持（第三十轮仅调顺序，样式不变）                      |
| 4   | CSS 注释（两处）  | 顺序描述「提供反馈 → 自动类 → 批准并继续」       | 更新为「自动类 → 批准并继续 → 提供反馈」                |

### 验证结果（Playwright 探针 + 截图实测 + vision 复核）

| 项               | 实测                                                                                          | 期望 |
| ---------------- | --------------------------------------------------------------------------------------------- | ---- |
| 按钮从上到下顺序 | 是，并跳过权限确认 → 是，且不再询问：npm → 批准并继续 → **提供反馈**（y 1019→1059→1099→1139） | ✓    |
| 浅色主按钮/ghost | 批准并继续炭黑实底白字；提供反馈透明无底文字（vision 复核）                                   | ✓    |
| 深色主按钮/ghost | 批准并继续浅灰实底；提供反馈 ghost（vision 复核）                                             | ✓    |
| 竖排间距/宽度    | gap 8 均匀、等宽全宽（vision 复核）                                                           | ✓    |
| type-check       | 通过                                                                                          | ✓    |

探针路径：desktop-full mock 的 showConfirmation（delay 1100，Bash 工具 → 触发 auto×2 + apply + feedback 四按钮）。

### 实现文件

- `src/components/ConfirmationDialog.tsx`（提供反馈按钮移到按钮列表末尾）
- `src/styles/host-desktop.css`（注释更新顺序描述）
- `src/styles/ConfirmationDialog.css`（注释更新顺序描述）

## 第三十一轮：会话状态看板（SessionBoard）整个界面还原（1 项评论）

评论：`div.session-board-header`「返回当前会话会话状态全部项目CC02」——「整个界面参考设计稿和项目进行还原」。

### 背景

会话状态看板（`.session-board`）为 wave 桌面端独有功能（codechat 无对应界面），此前样式全部走 `--vscode-*` token（VS Code 默认：filter vscode-dropdown r4、count vscode-badge 蓝底、card 透明 r4 边框），与桌面端已还原的 codechat 中密度规范脱节。本轮以 **Figma 权威节点 13561:39312「04 · 会话状态」**（卡片列表视图）为基准整体还原。Figma dump 关键值：

- 页面白底、内容 padding 16、标题行与列区 gap 16
- 顶栏 Header（返回按钮独立一行）：r8、icon+文字 gap 8、文字 14/500/#6C7076；行底边框 #EBEEF5
- 「会话状态」标题：16/600（PingFangSC-Semibold）/ #1F2329 / line-height 32
- Select Input：r6 / 白底 / 1px #DCDFE6 / padding 4 8 / label 14/400/#1F2329 / 箭头 #8B8F97
- 列头（13561:7557）：整行色块 + padding 12 + gap 8；等待 #FCF6EC / 运行 #EAEFFB / 完成 #F0F9EB；胶囊点（cornerRadius 全圆）等待 #F2D09F / 运行 #6D8EE6 / 完成 #16A34A；列名 14/600/#1F2329；数量 12/500/#6C7076 无底色
- 卡片区（13561:7560）：#F5F7FA + padding 12 + gap 8
- 卡片 Container：白底 r12 / padding 12 / 1px #EBEEF5；标题 14/600/#1F2329 + 项目 12/400/#6C7076 同行两端；状态行 12/400/#6C7076（「刚刚创建 / 运行 4 分钟 / 今天 17:32」）

### 变更点清单

| #   | 对象               | 修复前                                     | 修复后                                                                                                                                   |
| --- | ------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 页面结构           | 单行 header（back + 标题 + select 挤一行） | **两行**：顶栏（返回当前会话，独立一行，底边 #EBEEF5）+ 标题行                                                                           |
| 2   | 返回按钮           | r4 / 12px / vscode-foreground              | r8 / gap 8 / 14px 500 / #6C7076（hover #F0F2F5）                                                                                         |
| 3   | 「会话状态」标题   | 13/600 / vscode-foreground                 | **16/600 / #1F2329 / line-height 32**                                                                                                    |
| 4   | 项目筛选 select    | vscode-dropdown（r4 / 12px / 灰底）        | **r6 / 白底 / #DCDFE6 边框 / padding 4 8 / 14px**                                                                                        |
| 5   | 列头               | 透明底 + 列边框 + r6                       | **整行色块**（等待 #FCF6EC / 运行 #EAEFFB / 完成 #F0F9EB）pad 12                                                                         |
| 6   | 状态点             | `●` 字符（vscode token 颜色）              | **8×8 胶囊圆点**（#F2D09F / #6D8EE6 / #16A34A）                                                                                          |
| 7   | 列名/数量          | 列名 12/600；数量 vscode-badge（蓝底胶囊） | 列名 **14/600/#1F2329**；数量 **12/500/#6C7076 纯文字无底**                                                                              |
| 8   | 卡片区             | 无底色（透明）+ padding 8 10               | **#F5F7FA / padding 12 / gap 8**                                                                                                         |
| 9   | 会话卡片           | 透明底 r4 12px + 边框 + 单行标题           | **白底 r12 / padding 12 / 1px #EBEEF5** + 标题行（标题+项目两端）+ **状态行**                                                            |
| 10  | 卡片状态行（新增） | 无                                         | 相对时间：刚刚创建 / N 分钟前 / 运行 N 分钟 / 今天 HH:mm / 昨天 HH:mm                                                                    |
| 11  | 卡片 hover         | vscode-list-hoverBackground                | 柔影 0 2px 8px rgb(31 35 41/8%) + 边框加深（深色 8% 白底）                                                                               |
| 12  | 空态               | padding 18 0 顶部                          | flex 居中（margin auto）                                                                                                                 |
| 13  | 深色主题           | 沿用 VS Code 深色 token                    | 桌面端惯例：filter/卡片 #27292B、卡片区 6% 白、边框 12% 白、列头色块改状态色 12% 透明底（#CCA700/#6D8EE6/#16A34A）、文字 #E6E6E6/#9A9EA5 |

### 验证结果（Playwright 探针 + 截图实测 + vision 复核）

| 项                  | 实测（light / dark）                                                          | 期望 |
| ------------------- | ----------------------------------------------------------------------------- | ---- |
| 页面                | 白底 padding 16（dark：跟随会话区底）                                         | ✓    |
| 返回按钮            | 14px/500/#6C7076、r8（dark #9A9EA5）                                          | ✓    |
| 标题                | 16/600/#1F2329、line-height 32（dark #E6E6E6）                                | ✓    |
| select              | r6、白底、#DCDFE6、pad 4 8、14px（dark #27292B + 12% 白边框）                 | ✓    |
| 列头色块            | #FCF6EC / #EAEFFB / #F0F9EB（dark 状态色 12% 透明底）                         | ✓    |
| 胶囊点              | 8×8 r4、#F2D09F / #6D8EE6 / #16A34A                                           | ✓    |
| 列名 / 数量         | 14/600 #1F2329；12/500 #6C7076 无底（dark #E6E6E6 / #9A9EA5）                 | ✓    |
| 卡片区              | #F5F7FA、pad 12、gap 8（dark 6% 白）                                          | ✓    |
| 卡片                | 白底 r12、#EBEEF5、pad 12、标题+项目两端+状态行（dark #27292B + 12% 白）      | ✓    |
| 观感（vision 复核） | 两主题结构一致、色块语义正确、无错位溢出；深色略偏橄榄（状态色 12% 底）可接受 | ✓    |
| type-check          | 通过                                                                          | ✓    |

探针路径：desktop-full mock 侧边栏 activity 按钮（`desktop-sidebar-activity`）→ `.session-board`；mock 3 个会话均 running=false → 全部落入「已完成」列，等待/运行列验证空态。

### 实现文件

- `src/components/SessionBoard.tsx`（header 拆两行、列头色块 class + 胶囊点、卡片状态行 formatStatus）
- `src/styles/SessionBoard.css`（全量重写为 Figma 权威值 + 深色桌面惯例覆盖）

## 第三十二轮：面板标题去背景加粗 + 关闭图标统一（1 项评论）

评论：`span.preview-pane-url`「预览」——「这里不要背景色，预览、差异等标题字体要加粗，检查关闭图标，界面中所有的关闭图标要保持统一，可以参考设计稿」Figma 链接 node-id=12953-61026。

### 背景

① 第 28 轮只对 plan/file/diff/terminal 四个 pane 的 `.preview-pane-url` 去背景，**空态 preview-pane**（`data-testid="preview-pane-empty"`）里的「预览」占位标题仍在灰底胶囊（第 18 轮地址栏样式误用）——用户评论 DOM 正是该空态。② 标题字重 400 需加粗。③ 关闭图标不统一：预览/计划/差异/终端/文件 pane、确认弹窗、toast、btw 面板、图片预览 modal 等共 13 处仍用 codicon-close 字体图标，仅 DesktopShell 分屏关闭用了 SVG（ConversationCloseIcon），同一界面混用字体图标与 SVG。

Figma 权威（2026-CodeWave-交互视觉稿，dump 12953:61026「功能」COMPONENT_SET）：「关闭」variant = **圆角十字 12×12（臂宽 1.34、圆角 0.67）旋转 45° 成 ×**，外接 16.98 ≈ 17；normal 图标色 #565A60，hover 按钮底 #EEF0F3。

### 变更点清单

| #   | 对象                        | 修复前                                                       | 修复后                                                                                                      |
| --- | --------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 1   | 空态「预览」标题            | 灰底胶囊（light #F0F2F5 / dark 6% 白）                       | 去背景（补入第 28 轮选择器，`.preview-pane[data-testid="preview-pane-empty"]`）                             |
| 2   | 5 个 pane 标题加粗          | 字重 400（计划/文件/差异/终端/预览）                         | **font-weight 600**（地址栏 preview-address-display 保持 400 不受影响）                                     |
| 3   | CloseIcon 重画              | 16×16 实心粗 ×（旧 path）                                    | **Figma 12953:61026 权威 ×**：圆角十字 rotate 45，viewBox 0 0 17 17，fill currentColor                      |
| 4   | pane 关闭按钮（5 处）       | codicon-close 字体（Plan/Diff/File/Terminal + 空态 preview） | `<CloseIcon className="pane-close-icon" />`（空态用 preview-pane-icon）                                     |
| 5   | PreviewPane tab 关闭        | codicon-close                                                | `<CloseIcon className="preview-tab-close-icon" />`                                                          |
| 6   | 确认弹窗关闭                | codicon-close                                                | `<CloseIcon className="confirmation-close-btn-icon" />`（删 CSS 死规则 `.confirmation-close-btn .codicon`） |
| 7   | BtwPanel / ToastStack 关闭  | codicon-close                                                | CloseIcon（btw-panel-close-icon / toast-close-icon）                                                        |
| 8   | queue-warning 关闭          | codicon-close                                                | CloseIcon（queue-edit-warning-close-icon）                                                                  |
| 9   | workdir 菜单移除按钮        | codicon-close span                                           | CloseIcon（desktop-workdir-menu-remove-icon）                                                               |
| 10  | 图片预览 modal 关闭（2 处） | codicon-close 字体（Message/MessageInput innerHTML 注入）    | 内联 SVG（同权威 path，24×24）                                                                              |

### 验证结果（Playwright 探针 + 截图实测 + vision 复核）

| 项                          | 实测（light / dark）                                                         | 期望 |
| --------------------------- | ---------------------------------------------------------------------------- | ---- |
| 5 个 pane 标题              | background transparent + font-weight 600（预览/计划/差异/终端/文件，双主题） | ✓    |
| 关闭按钮 SVG 统一           | 全部 viewBox 0 0 17 17、path 以 M8.51 开头（权威 ×），无 codicon-close 残留  | ✓    |
| 空态预览关闭按钮            | 24×24 按钮 + 16×16 SVG（light/dark，vision 复核清晰居中）                    | ✓    |
| 完整态预览/文件面板关闭按钮 | × 粗细一致、垂直居中、双主题可见（vision 复核）                              | ✓    |
| type-check                  | 通过                                                                         | ✓    |

探针路径：desktop-full mock → panel-toggle 菜单勾选「预览/计划/差异/终端/文件」→ 逐 pane 读 `.preview-pane-url` computed；Escape 关菜单后截空态预览图。

### 实现文件

- `src/components/HeaderIcons.tsx`（CloseIcon 重画为 Figma 12953:61026 权威 ×）
- `src/components/PlanPane.tsx` / `DiffPane.tsx` / `FilePane.tsx` / `TerminalPane.tsx`（关闭按钮 codicon → CloseIcon）
- `src/components/ChatApp.tsx`（空态 preview 关闭 + queue-warning 关闭）
- `src/components/PreviewPane.tsx`（tab 关闭 codicon → CloseIcon）
- `src/components/ConfirmationDialog.tsx` / `BtwPanel.tsx` / `ToastStack.tsx` / `DesktopWorkdirSelector.tsx`（关闭/移除图标 → CloseIcon）
- `src/components/Message.tsx` / `MessageInput.tsx`（图片预览 modal innerHTML → 内联权威 SVG）
- `src/styles/host-desktop.css`（第三十二轮段：空态标题去背景 + 标题加粗 600）
- `src/styles/ConfirmationDialog.css`（删除 `.confirmation-close-btn .codicon` 死规则）

---

## 第三十四轮（2026-03）：极限状态 6 项样式修复（修复不推送）

用户对第 33 轮极限消息流逐元素评审，提出 6 项样式问题；本轮全部修复，**不 commit 不 push**（用户检查后再定）。

### 问题与修复对照

| #   | 元素                                         | 问题                                                                                                                                                        | 修复                                                                                                                                                                                                                            |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ①   | `.message-content.user-content`              | 超长用户消息被 `max-height: 200px + overflow-y: auto` 截断，气泡内滚动条缩在 `.user-text-block` padding 内 12px，未贴气泡右缘（不符合滚动条「贴右缘」规范） | 气泡 padding 移到内容区：`.user-text-block` padding 归零 + `.user-content` 补 `box-sizing: border-box; padding: 8px 12px`，滚动条轨道贴气泡右缘（gap=0）；max-height 200px 截断与滚动条保留（用户确认滚动条应存在，只需调位置） |
| ②   | `.markdown-content blockquote`               | 背景用 VSCode 默认 textBlockQuote-background（light #eaeaea / dark #2b2b2b），非设计系统色                                                                  | light token → `#f0f2f5`（--cc-fill）；dark token → `rgba(255,255,255,.06)`（fill 6% 白）；左边条 border 同步 `#dcdfe6` / 12% 白                                                                                                 |
| ③   | `.markdown-content code`（行内）             | 背景 textCodeBlock-background light #f7f8fa 过浅、dark 与 pre 同色无区分                                                                                    | 桌面覆盖 `:not(pre) > code`：light `#eef0f3`（--cc-fill-hover）、dark `rgba(255,255,255,.08)`                                                                                                                                   |
| ④   | `.bash-command-unified .bash-command-output` | light 下 unified 外框（r12 #dcdfe6）+ 输出区独立描边 #dcdfe6 构成双层边框线                                                                                 | 去掉内层 output 的 light `border: 1px solid #dcdfe6`，保留白底分层，只留 unified 外框一圈                                                                                                                                       |
| ⑤   | `.write-preview-box`                         | 圆角 base 6px，与 bash-unified 12px 不一致                                                                                                                  | 桌面覆盖 `border-radius: 12px`                                                                                                                                                                                                  |
| ⑥   | `.markdown-content pre`                      | 圆角 base 6px 不一致；dark 下背景 VSCode 默认 #2b2b2b、边框 #616161 与消息区违和                                                                            | 圆角 12px 统一；dark token 补 `--vscode-textCodeBlock-background: #27292b`（面板色）+ `--vscode-textBlockQuote-border: rgba(255,255,255,.12)`                                                                                   |

### Token 层变更（host-desktop.css）

- light 层新增：`--vscode-textBlockQuote-background: #f0f2f5`、`--vscode-textBlockQuote-border: #dcdfe6`
- dark 层新增：`--vscode-textCodeBlock-background: #27292b`（原缺失，VSCode 默认 #2b2b2b 是 ⑥ 违和根源）、`--vscode-textBlockQuote-background: rgba(255,255,255,.06)`、`--vscode-textBlockQuote-border: rgba(255,255,255,.12)`

影响面核查：textBlockQuote-border 还被 reasoning-content（桌面有专用 2px #E4E7ED / 14% 白覆盖，不受影响）、lsp-output、TodoList（同步变设计系统边框，合理）使用。

### 验证结果（Playwright 探针双主题 computed + vision 复核）

| 项                       | light                                                                                     | dark                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| ① 气泡内滚动条贴右缘     | `.user-content` 右缘 = 气泡右缘（gap 0，双主题）、max-height 200px / overflow-y auto 保留 | 同                                                     |
| ② blockquote 背景        | rgb(240,242,245)=#f0f2f5 ✓                                                                | rgba(255,255,255,.06) ✓                                |
| ③ 行内 code 背景         | rgb(238,240,243)=#eef0f3 ✓                                                                | rgba(255,255,255,.08) ✓                                |
| ④ bash 输出边框          | border 0（外层 unified 一圈）✓                                                            | border 0 ✓                                             |
| ⑤ write-preview-box 圆角 | 12px ✓                                                                                    | 12px ✓                                                 |
| ⑥ pre 圆角/背景/边框     | 12px / #f7f8fa / #dcdfe6 ✓                                                                | 12px / rgb(39,41,43)=#27292b / rgba(255,255,255,.12) ✓ |

vision 复核：双层边框消除、圆角肉眼一致、深色 pre 与消息区层次自然、引用块/行内 code 对比清晰。sticky 用户消息 line-clamp 3 为设计意图（置顶卡折叠预览），非缺陷。

备注：滚动条 thumb 在 headless Chromium 下不渲染（overlay 行为），无法截图验证；滚动条规范（16px 轨道 / 8px pill / 三态）已由第二十一、二十二轮实现并验证，thumb 几何（scrollTop 比例 → 轨道内位置）实测正确。

### 实现文件

- `src/styles/host-desktop.css`（第三十四轮段：token 层 2 处新增 + bash output 去边框 + write/pre 圆角 + 行内 code 覆盖 + user-content padding 转移使滚动条贴右缘）

---

## 第三十五轮（2026-03）：极限状态 4 项修正（不推送）

用户对第 34 轮修复后状态继续评审，提出 4 项新问题；本轮全部修复，**不 commit 不 push**。

### 问题与修复对照

| #   | 元素                     | 问题                                                     | 根因                                                                                                                        | 修复                                                                                        |
| --- | ------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ①   | `.markdown-content ol`   | 列表编号（1./2./3.）渲染在 ol 左边界左侧，溢出列表区域   | `list-style-position: outside` 的 marker 从 li 左缘向左延伸约 28px（数字+句点+后缀空格），而 base `padding-left: 20px` 不足 | 桌面端 `padding-left: 28px`，编号完整容纳（实测编号左缘 282→ 移入 ol 内，元素截图编号完整） |
| ②   | `.diff-viewer-container` | 圆角 base 4px，与其他工具块（bash/write/pre 12px）不一致 | base DiffViewer.css L7 `border-radius: 4px`                                                                                 | 桌面覆盖 `border-radius: 12px`                                                              |
| ③   | `.compact-params`        | 字号 base 11px，应为 12px                                | base Message.css L514 `font-size: 11px`                                                                                     | 桌面覆盖 `font-size: 12px`（与 Figma 文件统计 12px 同档）                                   |
| ④   | `.write-preview-content` | Write 预览内容字号 12px 偏小                             | base Message.css L409 `font-size: 12px`                                                                                     | 桌面覆盖 `font-size: 13px; line-height: 18px`（与 bash 输出 13px 统一）                     |

### 验证结果（Playwright 探针双主题 computed + vision 复核）

| 项                    | light                                                       | dark        |
| --------------------- | ----------------------------------------------------------- | ----------- |
| ① 列表 padding / 编号 | padding-left 28px，元素截图编号 1./2./3. 完整、左侧留白正常 | 同          |
| ② diff 圆角           | 12px                                                        | 12px        |
| ③ compact-params 字号 | 12px                                                        | 12px        |
| ④ write 预览字号      | 13px / 行高 18px                                            | 13px / 18px |

vision 复核：编号完整可见无裁切、嵌套缩进清晰、compact-params 与正文协调。

### 实现文件

- `src/styles/host-desktop.css`（第三十五轮段：列表 padding 28px + diff 圆角 12px + compact-params 12px + write-preview-content 13px）

---

## 第三十六轮（2026-03）：context-usage 环形进度对齐 Figma 13438:8668（不推送）

用户评审 `span.compress-context-button`（「64%」）：「检查环形进度条大小、进度字体字号颜色等，添加和/ 图标颜色不统一」，参考 Figma 13438:8668「功能」组件集。本轮全部修复，**不 commit 不 push**。

### Figma 权威值（13438:8668「功能」组件集 dump）

| 组件           | 尺寸  | 值                                                                                                  |
| -------------- | ----- | --------------------------------------------------------------------------------------------------- |
| 压缩上下文     | 59×32 | 图标 16×16：track 半环 `#D4D7DE` + fill 弧 `#565A60`；文字「24%」14px/400 `#565A60`，31×20，gap 4px |
| 添加（normal） | 32×32 | 16×16 图标内 Union 12×12 `#565A60`（cap=round）                                                     |
| 设置（normal） | 32×32 | Subtract 13×13 `#565A60` + Line 325 6×8 `#565A60`                                                   |
| hover 底       | —     | `#EEF0F3` r6                                                                                        |

### 问题与修复对照

| #   | 元素                           | 问题                                                                  | 修复                                                                                             |
| --- | ------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ①   | `.compress-context-ring`       | base 14×14；track stroke descriptionForeground@0.4、fill currentColor | 桌面 16×16；track `#D4D7DE` op 1（dark 12% 白）、fill `#565A60`（dark `#9A9EA5`），线宽 2.6 保持 |
| ②   | `.compress-context-pct`        | base 11px/400、color vscode-foreground（light #202020 深黑）          | 桌面 14px/400/lh 20px、color `#565A60`（dark `#9A9EA5`）—— 与 +/ 图标 #565A60 统一               |
| ③   | `.compress-context-button`     | padding 0 6px → 按钮 62px，宽于 Figma 59px                            | padding 0 4px → 按钮 58×32 ≈ 59×32（16+4+30+8）                                                  |
| ④   | +/ 图标（toolbar-icon-button） | 颜色 base vscode-icon-foreground                                      | 前轮已改 `#565A60`/dark `#9A9EA5`；本轮复核确认统一，不改                                        |

### 验证结果（Playwright 探针双主题 computed + vision 复核）

- 探针环境注意：desktop mock 的 focused pane composer 被 inline `style="display:none"` 的无 class div 包裹（mock 宿主隐藏容器，非 CSS 缺陷），compress 默认 0×0 不可见 → 验证时 JS 强制显示该层。
- computed：ring 16×16；track light `rgb(212,215,222)`=#D4D7DE op 1 / dark `rgba(255,255,255,.12)`；fill light #565A60 / dark #9A9EA5（dasharray 32.17/50.27 = 64% 周长 ✓）；pct 14px/400/lh 20px #565A60 / #9A9EA5，宽 30px；按钮 58×32。
- vision 复核：图标完整、文字 14px 清晰、垂直居中对齐良好；track #D4D7DE 在白色上对比低、64% 进度下 fill 弧接近整圈是 Figma 设计属性（进度表达），非缺陷。

### 实现文件

- `src/styles/host-desktop.css`（第三十六轮段：compress-context-ring 16×16 + track/fill 色值 + pct 14px + 按钮 padding 0 4px；dark 映射 track 12% 白 / fill #9A9EA5）

---

## 第三十七轮（2026-03）：收起态 header 分割线与标题间距（不推送）

用户评审 `span.header-collapsed-divider`：「分割线和后面标题距离过近」。

### 问题与修复

| 元素                        | 问题                            | 根因                                                                                                                                                                                               | 修复                                                                                                                                           |
| --------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `.header-collapsed-divider` | 分割线右缘紧贴后面标题（gap 0） | divider 是 `.header-collapsed-leading`（flex gap 8）的**末子元素**，容器 gap 只作用于子元素之间、不覆盖它后面；标题 `.header-title` 在 leading 容器外（`.chat-header` 的直接子元素），两者间无间距 | base ChatHeader.css `.header-collapsed-divider` 补 `margin-right: 8px`（与 leading 内 gap 一致，对齐 codechat `workspace-header-start` gap 8） |

codechat 参照：`WorkspaceHeader.vue` 收起分支中 divider 与 h1 标题同属 `.workspace-header-start`（global.css L2033-2039，flex gap 8）→ divider↔标题间距 8px；wave 的标题移出 leading 容器导致 gap 失效，需显式 margin-right。

### 验证结果（Playwright 探针双主题）

- light：divider 右缘 77 → 标题左缘 85，gap 8px；divider 色 rgb(220,223,230)=#DCDEE6 ✓
- dark：gap 8px；divider 色 rgba(255,255,255,.12) ✓

### 实现文件

- `src/styles/ChatHeader.css`（`.header-collapsed-divider` margin 0 → `margin-right: 8px`）

---

## 第三十八轮（2026-03）：图标规范走查 + 设置界面图标替换（Figma 13383:4078 权威）

用户：「参考图标规范，检查所有 icon 默认颜色、交互色是否正确，参考设计稿和应用替换设置界面图标」。Figma 节点 **13383:4078「图标」**（功能组件集）dump 权威值。

### Figma 图标规范（13383:4078「功能」组件集）

- 所有图标 **normal 与 hover 图标色均 #565A60**（24×24 画布 / 16px glyph；仅「活动器 hover」#C1292E 品牌红）
- hover 变化的是**按钮底** #EEF0F3（--cc-fill-hover），图标色保持不变
- 设置界面图标 = codechat-ui `src/assets/figma/settings-*.svg`（Figma 直接导出，16×16 stroke 1.4）

### 问题与修复对照

| #   | 元素                     | 问题                                                                                                                                                                                                                                              | 修复                                                                                                                                                                                   |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ①   | 设置页 7 导航 + 返回按钮 | codicon 字体图标（settings-gear/person/repo/lightbulb/account/link/globe/arrow-left）                                                                                                                                                             | HeaderIcons 新增 8 个 Figma SVG（SettingsGlobal/Personalization/Project/Skills/Subagents/Hooks/Mcp/BackIcon，stroke currentColor），SettingsPage.tsx 换用、删 codicon                  |
| ②   | 设置导航图标色           | base `--vscode-icon-foreground`（light 偏暗）                                                                                                                                                                                                     | desktop 覆盖 `#565A60` / dark `#9A9EA5`（16×16 保持）                                                                                                                                  |
| ③   | 设置导航 hover/active 底 | base vscode token：hover 半透明黑、**active VS Code 蓝**（dark rgb(4,57,94)）明显违和                                                                                                                                                             | hover `#EEF0F3`（dark 8% 白）、active `#E7E9ED` + 文字 `#1F2329`（dark 12% 白 + #FFF）；图标色 active 保持 #565A60（codechat 选中只变文字与底）                                        |
| ④   | 桌面控件图标色（11 处）  | 继承 `--vscode-foreground`（light #202020 深黑）：sidebar-more/new-chat/session-more/account-more/panel-toggle/pane-close/write-preview-open/toast-close/confirmation-close + 2 处 codicon 残留（group-header caret、workdir-trigger git-branch） | 统一 `#565A60` / dark `#9A9EA5`；**`.desktop-sidebar-more-btn.is-active` 品牌红 #C1292E 保留**（规范「活动器」）；workdir-trigger/session-group-header 只覆盖 .codicon，按钮文字色不动 |

保留：品牌 wordmark（logo）多色、send 禁用态浅灰 #BEC1C6、活动器红色态。

### 验证结果（Playwright 探针双主题 computed + vision 复核）

- 设置页：7 导航 + 返回 svg 16×16 全 `#565A60`（dark `#9A9EA5`）；active 底 #E7E9ED/文字 #1F2329（dark 12% 白/#FFF）、hover 底 #EEF0F3（dark 8% 白）、active/hover 图标色不变 ✓
- 11 处控件图标双主题全部 `#565A60`/`#9A9EA5` ✓
- vision 复核：设置导航图标完整清晰、无字体残留、各主题下颜色统一；「新对话/返回箭头偏深」为 16px 小图标在缩略截图中的感知偏差（computed 均为 #565A60，与第 23 轮教训一致：以 computed 为准）

### 实现文件

- `src/components/HeaderIcons.tsx`（新增 8 个 Settings\*Icon）
- `src/components/SettingsPage.tsx`（导航 icon 字段改 React 组件、返回按钮换 SVG）
- `src/styles/SettingsPage.css`（codicon 尺寸规则 → svg 规则）
- `src/styles/host-desktop.css`（第三十八轮段：设置图标色 + 导航 hover/active 底 + 11 处控件图标色）

---

## 第三十九轮（2026-03）：下拉菜单选项间距归零（用户：panel-toggle-menu 选项之间不应有间距）

用户评审 `div.panel-toggle-menu`（预览/计划/差异/终端/文件面板切换菜单）：「选项之间不应该有间距，检查所有下拉菜单是否有类似问题后修复」。

### 问题与修复

| 菜单                 | 问题                | 根因                                    | 修复                  |
| -------------------- | ------------------- | --------------------------------------- | --------------------- |
| `.panel-toggle-menu` | 选项之间有 4px 间距 | base PanelToggleMenu.css L10 `gap: 4px` | desktop 覆盖 `gap: 0` |
| `.more-menu`         | 同（4px 间距）      | base MoreMenu.css L8 `gap: 4px`         | desktop 覆盖 `gap: 0` |

codechat 权威：`workspace-header-menu` / el-dropdown-menu 菜单项**连续排列**（容器 pad 8、item 32px 高、item 之间无 gap）。

### 全量菜单间距核查（其余无问题）

- `.desktop-session-menu` / `.desktop-workdir-menu`：item 之间无 gap ✓（gap 6px 是 item 内部图标↔文字间距）
- `.session-list-popup` gap 8px = 搜索框与列表的间距（codechat session-list 同布局），非选项间距 ✓
- `.account-usage-popup` gap 10px = 浮层内容行距（wave 独有组件，codechat 无参照）✓
- `.more-menu` 中 logout 前 17px 间距 = 分隔线（margin 8×2 + 1px 线），设计意图 ✓

### 验证结果（Playwright 探针 + vision 复核）

- panel-toggle-menu：gap CSS 0、相邻项间距 [0,0,0,0]、项 32px 高、容器 pad 8 ✓
- more-menu：gap 0、项间距 [0,0,17]（17 = logout 前分隔线）✓
- session-menu：gap normal、项间距 [0] ✓
- vision 复核：五项均匀紧密排列、文字/快捷键各自成列；「预览项 focus ring 描边」是键盘焦点样式（无障碍）、「计划/文件无快捷键」为数据未配置，均非样式缺陷

### 实现文件

- `src/styles/host-desktop.css`（第三十九轮段：`.more-menu`/`.panel-toggle-menu` gap 0）

---

## 0902 新基线第 1 轮（2026-09）：41① 灰条去蓝偏 + 41③ 权限按钮深色 :focus 修复

> **新基线说明**：本地 40-42 轮工作已删除，仓库重置回 `origin/main`（`129d1757`，第 39 轮为最新）。**本轮起为新代码基线上的第 1 轮**，内容对应桌面记录 `~/Desktop/CC02-wave-41a-41c-42-style-changes.md` 的 **41① + 41③**（该文件的 42 轮 MoreMenu 不在本轮范围，后续如需再应用）。

### 41① 新会话上下文栏（灰条）深色背景中性化 `#27292b` → `#292929`

用户评审「本地 CC02 main worktree」灰条：「深色模式的这里的灰感觉有些偏蓝，可以更中性一些」。

- **根因**：深色背景原用 `#27292B` = rgb(39,41,43)，B 通道（43）比 R/G 偏高，紧邻中性卡片 `#313131` 时显偏蓝。
- **修改**：`[data-host="desktop"][data-theme="dark"] .input-workdir-row` 的 `background` `#27292b` → `#292929`（等亮度中性灰，去蓝偏；「卡片 #313131 在上、灰条略深在下」层次保持）。
- **验证**（8899 Playwright 探针）：dark computed `rgb(41, 41, 41)` ✓；light 仍 `#f5f7fa`（浅色规则不受影响）✓。

### 41③ 权限按钮（permission-mode-select）深色 :focus 反白修复

用户评审「自动接受修改」按钮：「深色模式这个按钮会有反白的情况，不应该出现」。

- **根因**：深色规则只有 `:hover` 覆盖，`:focus` 落入浅色规则 `background:#EEF0F3 / color:#1F2329` → 点击按钮获得焦点后即浅底深字反白。
- **修改**：深色段 `:hover` 扩展为 `:hover, :focus`（`.permission-mode-select` 与 `.mode-bypassPermissions` 两处），hover/focus 统一深色覆盖，bypass 红字保持。
- **验证**（8899 Playwright 探针，focus 后等待 ≥400ms 覆盖 0.2s transition）：非 bypass focus = `rgba(255,255,255,0.08)` / `#fff` ✓；bypass focus 保持红字 `#f4655c` 且背景同深色覆盖 ✓；light `:focus` 浅色规则照旧无回归 ✓；0 console errors ✓。

### 实现文件

- `src/styles/host-desktop.css`（41① `.input-workdir-row` dark 背景段；41③ `.permission-mode-select` 深色 hover/focus 段）

---

## 0902 新基线第 2 轮（2026-09）：任务列表/消息队列卡片对齐输入框规格 + 状态色合规

用户预览评论 `div.task-list-inline` / `div.queued-item` / `div.queued-message-list-container`：「任务列表和消息列队的整体宽度应该和下方的输入框保持一致，圆角也和下方输入框保持统一，字号14px，消息列队选项高度32px」「hover状态圆角等要符合规范」「整体卡片和下方对话框要有间距8px」；随后追加「检查任务列表、消息列表中的颜色，看看是否符合规范」。

### A. 卡片布局对齐输入框规格（host-desktop.css）

| 项               | base                             | 桌面规范（= 输入框）                          | 修复                                                      |
| ---------------- | -------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| 卡片宽度         | max-width 800px                  | 768px（input-wrapper）                        | 两卡统一 768                                              |
| 圆角             | 8px                              | 16px（input-content r16）                     | 统一 16                                                   |
| 主体字号         | 12px / lh16                      | 14px / lh20                                   | 标题/任务行/队列标题/队列条目统一 14                      |
| 统计文字         | 12px / editor-foreground         | 12px 次级弱化（codechat xs + text-secondary） | #6C7076 / dark #9A9EA5                                    |
| 队列选项高       | 24px / r4                        | 32px / r6                                     | height 32 + radius 6                                      |
| 队列 hover 底    | vscode list-hoverBackground 蓝灰 | codechat fill-hover                           | #EEF0F3 / dark 8% 白                                      |
| 卡片↔输入框间距 | 无                               | 8px                                           | queued 卡 margin-bottom 8；连体时 task 卡贴齐、归零连接处 |
| 滚动上限         | 102px                            | 110px                                         | 4 任务 × 20px 行高 + 3 × 10px 间距                        |

连体结构沿用 base `:has(+ .queued-message-list-container)` 归零逻辑，仅半径 8→16。

### B. 状态色对齐 codechat state tokens（host-desktop.css + TaskList.tsx）

权威：codechat TaskList.vue `task-stat-dot`/`task-list-item-icon` 共用 `--cc-state-succeeded #16a34a / --cc-state-running #2f5edb / --cc-state-idle #98a2b3`（dot 与行 icon 同状态同色）；wave 内部同色先例：时间线节点 #16a34a、SessionBoard dot 深浅同值、桌面链接 #2f5edb/#4daafc。

| 元素                | base/修复前                       | 规范                         | 修复                                                                                                     |
| ------------------- | --------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| stat dot 已完成     | #73C991（iconPassed token）       | #16a34a                      | TaskList.tsx stats 加 `is-succeeded/is-running/is-pending` 类，desktop 覆盖（inline style → !important） |
| stat dot 进行中     | #75BEFF（--wave-blue 未定义回退） | #2f5edb                      | 同上                                                                                                     |
| stat dot 待执行     | #606060/#ccc                      | #98a2b3                      | 同上                                                                                                     |
| 行 icon 已完成      | svg fill #89D185 硬编码           | #16a34a                      | svg fill 为 presentation attribute，CSS `fill` 普通规则覆盖；按行内 title 状态 class 以 `:has()` 定位    |
| 行 icon 进行中      | fill #CCCCCC                      | #2f5edb                      | 同上                                                                                                     |
| 行 icon 待执行      | fill #CCCCCC                      | #98a2b3                      | 同上（mock 无待执行行，规则生效不可视验证）                                                              |
| 依赖行「依赖 #x」   | textLink #0069cc                  | 链接 #2f5edb / dark #4daafc  | desktop 覆盖（mock 无依赖任务，规则生效不可视验证）                                                      |
| 两卡 header chevron | vscode-foreground 黑              | 控件图标灰 #565A60 / #9A9EA5 | 并入第 38 轮图标清单同值                                                                                 |
| queue action 图标   | icon-foreground #606060/#ccc      | 图标灰 #565A60 / #9A9EA5     | 常态灰；hover 底 #E7E9ED / 12% 白、字 #1F2329/#FFF（session-more-btn 先例）                              |

深色不做单独状态色：codechat 无 dark token，状态色与时间线/会话看板一致深浅同值。

### 验证结果（8899 Playwright 探针，两主题）

- dot/行 icon 三状态 = rgb(22,163,74)/(47,94,219)/(152,162,179)，两主题一致 ✓
- stat-text #6C7076（light）/ #9A9EA5（dark）✓；chevron/action 图标 #565A60 / #9A9EA5 ✓
- action hover light #1F2329 + #E7E9ED、dark #FFF + 12% 白 ✓；队列项 hover #EEF0F3 / 8% 白 ✓
- title 弱化：completed 行 #606060/#9D9D9D + 删除线（保持 base 语义）✓

### 实现文件

- `src/styles/host-desktop.css`（0902 新基线第 2 轮段：布局规格 + 颜色覆盖）
- `src/components/TaskList.tsx`（stats 数组补 `is-succeeded/is-running/is-pending` 类并应用到 stat dot span）

---

## 0902 新基线第 3 轮（2026-09）：more-menu 菜单项前置图标（对齐 codechat TaskSidebar）

用户预览评论 `div.more-menu`「设置/企业控制台/帮助文档/退出登录」：「参考 ccui 的项目，给这里添加图标，但是企业控制台、帮助文档 末尾的跳转图标保留」。

### 母版（ccui TaskSidebar.vue sidebar-more 弹层）

菜单项前置 lucide 图标（Settings/House/CircleHelp/LogOut，`<… :size="17"/>`，`.el-dropdown-menu__item` flex + gap）；wave 桌面菜单统一规格已在第十三/三十九轮对齐（32px 高 / 14px / r6 / fill-hover），图标按 wave 控件图标尺度 16×16 渲染、stroke currentColor 跟随文字色（危险项自动随红）。

### 修改

| 文件              | 内容                                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HeaderIcons.tsx` | 新增 4 个 lucide 图标组件：SettingsGearIcon / HouseIcon / HelpCircleIcon / LogOutIcon（16×16 渲染、24 viewBox、stroke 2 currentColor，路径取自 ccui node_modules lucide 源）                             |
| `MoreMenu.tsx`    | entries 前置图标：设置=齿轮；企业控制台=房子、帮助文档=问号圆圈，图标+文字包进 `more-menu-item-leading` 左组、行尾保留 ExternalLinkIcon（space-between 需两直接子）；退出登录=门+箭头（danger 红色跟随） |
| `MoreMenu.css`    | `.more-menu-item` 补 `gap: 8px`；新增 `.more-menu-item-leading { display:inline-flex; align-items:center; gap:8px; min-width:0 }`                                                                        |

### 验证（8899 Playwright 探针 + 截图，两主题）

- 四行前置图标均可见，企业/帮助行尾 ↗ 保留 ✓
- item 32px 高、图标 16×16、gap 8px、菜单宽 160px 文字无挤压溢出 ✓
- 图标色跟随文字：light #565A60 / dark #9A9EA5；退出登录 light/dark 均 #D92D20 系（dark 稍柔）✓

### 实现文件

- `src/components/HeaderIcons.tsx`、`src/components/MoreMenu.tsx`、`src/styles/MoreMenu.css`

---

## 0902 新基线第 4 轮（2026-09）：bash 命令输出内链接深色补覆盖（dark #4daafc）

用户预览评论 `#messagesContainer … a:nth-of-type(1)`（bash 输出内的 `http://localhost:8899/` 链接）：「检查下深色模式这里链接的颜色为什么和其他地方不一样」。

- **根因**：第二十六轮消息内链接统一时 dark 覆盖组只写了 `.write-tool-path` 与 `.markdown-content a`，遗漏 `.bash-command-output a`——其第 768 行规则固定浅色链接蓝 #2f5edb，dark 下比 markdown 链接 #4daafc 暗且发蓝。
- **修改**：dark 覆盖组补入 `.bash-command-output a` 及 `:hover` → #4daafc（与 write-tool-path / markdown 一致）；light 保持 #2f5edb 不变。
- **验证**（8899 探针）：目标链接 dark = rgb(77,170,252) ✓，与容器内 markdown 链接同色；light 仍 #2f5edb ✓。

### 实现文件

- `src/styles/host-desktop.css`（第二十六轮链接统一段内补 dark bash 链接覆盖）

---

## 0902 新基线第 5 轮（2026-09）：账户更多按钮换问号圆 + 帮助文档图标改文档（对齐 ccui figma-icon-button）

用户预览评论 `svg.account-card-more-icon`（账户卡片「更多」按钮三点图标）：「把这个三个点图标换成现在帮助文档的图标，把帮助文档的图标，换成类似文档的图标，再检查下这个区域背景色、圆角是否符合规范」。

### 修改（图标职责对调 + 区域规格检查）

| 文件               | 内容                                                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HeaderIcons.tsx`  | 新增 `FileTextIcon`（lucide file-text 文档：纸页折角+文字横线，24 viewBox stroke 2，与既有 lucide 菜单图标同风格）                                                                                                     |
| `AccountCard.tsx`  | 登录/未登录两处更多按钮 `MoreIcon`（三点）→ `HelpCircleIcon`（问号圆圈，即第 3 轮帮助文档图标）                                                                                                                        |
| `MoreMenu.tsx`     | 帮助文档项图标 `HelpCircleIcon` → `FileTextIcon`（↗ 行尾跳转图标保留）                                                                                                                                                |
| `host-desktop.css` | 更多按钮区域规格检查：base r4 + vscode list-hoverBackground 蓝灰 → 对齐热区 r6 + hover #E2E4E8 / dark 14% 白（ccui figma-icon-button / sidebar-account-more 32×32 r6 fill-hover；同排热区与按钮两档灰/两档圆角不一致） |

背景/圆角检查结论：账户卡片整体仍透明贴合侧栏 + 上分隔线 #EBEEF5（ccui sidebar-account 同款，无独立卡片底），仅按钮自身规格补齐。

### 验证（8899 Playwright 探针 + 截图，两主题）

- 更多按钮图标 = 问号圆圈（circle×1 + path×2）✓；帮助文档 = 文档页（path×5）✓；企业/帮助行尾 ↗ 保留 ✓
- 更多按钮 hover 与热区同色：light #E2E4E8 / dark 14% 白，同 r6 ✓（修改前按钮 hover 为 vscode list-hoverBackground 蓝灰、r4）
- type-check + accountCard/moreMenu 21 测试全绿 ✓

### 实现文件

- `src/components/HeaderIcons.tsx`、`src/components/AccountCard.tsx`、`src/components/MoreMenu.tsx`、`src/styles/host-desktop.css`

---

## 0902 新基线第 6 轮（2026-09）：预览标签 hover 底色对齐 fill-hover

用户预览评论 `div.preview-tab`「localhost:8899」：「检查这里hover状态下的颜色是否符合规范」。

- **根因**：`.preview-tab:hover` 用 base 的 `var(--vscode-list-hoverBackground)`——桌面下实际渲染 light `rgba(0,0,0,0.08)`（≈#EBEBEB）、dark `#2a2d2e`，是 VS Code 默认蓝灰/中性黑调，未纳入桌面设计系统色板（同类 hover 早已统一 `--cc-fill-hover`：queued-item/菜单项/账户热区）。
- **修改**：host-desktop.css 预览标签段补 hover 覆盖 —— 非激活 hover light `#EEF0F3` / dark 8% 白；active 标签 hover 用 `:not(.active)` 限定保持激活底不漂移。
- **验证**（8899 探针，注入真实 class 元素取 computed）：light hover = rgb(238,240,243) ✓、dark = rgba(255,255,255,0.08) ✓、active hover 保持 #F0F2F5 / dark 原激活色 ✓。

### 实现文件

- `src/styles/host-desktop.css`（预览标签段补 hover fill-hover 覆盖）

---

## 面板五图标对齐 Figma Component 12（13561:39702）+ 文件空态竖排 + toolbar 标题加粗（2026-09，bdb023c9 基线）

预览评论 5 条（`.panel-toggle-menu--tabs` / 面板空态 / FilePane placeholder / `.desktop-panel-toolbar-title` / 地址栏 globe）：「按照设计稿更新这 5 个图标」「这里也同步更新，图标在上方文案在下方，图标尺寸 24px」「这个位置的标题都加粗」「这里在文案前面加上图标」「这里也是预览图标」。

### 设计源（Figma 权威）

「CC桌面端组件库」v92f0XaCeMV7467qzIh6en 节点 `13561:39702` Component 12（COMPONENT_SET，5 variants：预览/计划/差异/终端/文件）。用 REST API 拉 node JSON + SVG 导出（`/tmp/icon-*.svg`）取得官方矢量：

- 预览 = 地球（**fill 挖空型** Union，`fill-rule=evenodd`，viewBox 16）
- 计划 = 剪贴板（clipboard：圆角板身 + 顶部空心夹 + 3 条左对齐横线）
- 差异 = 纸页 + 内部分割（文件轮廓 + 两条短横线 + 一条竖线，viewBox **0 0 16 17** 高 17）
- 终端 = 圆角框 + `>_` 提示符
- 文件 = 右上折角纸页 + 一条折痕线
- 均 stroke #565A60 / width 1.4 / round cap-join（preview 除外），16px 网格

### 实现

新建 `src/components/PanelKindIcon.tsx`：官方 path 内嵌，`fill/stroke = currentColor`（跟随菜单/标签/空态文本色，light #565A60 / dark #9A9EA5 由 host-desktop.css 既有组控制）；`kind` + `size` prop（diff 按 16:17 等比增高），替代原 codicon 五图标：

| 位置                                                    | 替换                                                                         | 尺寸 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | ---- |
| DesktopPanelTabs tab strip（PANEL_ICONS）               | codicon-browser/list-unordered/diff/terminal/file-code → PanelKindIcon       | 13px |
| PanelEmptyState 空态 grid（PANEL_EMPTY_ICONS）          | 同上                                                                         | 14px |
| PanelToggleMenu 菜单项 label 前新增图标                 | 新增（PANEL_ITEMS 数据不变，渲染处按 kind 映射）                             | 16px |
| PreviewPane 地址栏 `.preview-pane-url`（codicon-globe） | PanelKindIcon preview（「这里也是预览图标」）                                | 13px |
| PreviewPane `preview-tab-new` 空态 globe                | 同上                                                                         | 28px |
| FilePane 空态 placeholder（codicon-file 22px 横排）     | PanelKindIcon file，容器 `.file-pane-placeholder-empty` 竖排（图标上文案下） | 24px |

标题：`.desktop-panel-toolbar-title` 补 `font-weight: 600`（评论「这个位置的标题都加粗」，计划/差异/终端/文件 pane 共用）。
CSS：各处 `… .codicon` 尺寸/透明度规则同步迁移到新 svg 类（`.desktop-panel-tab-icon` / `.desktop-panel-empty-item-icon` / `.preview-pane-url-icon` / `.preview-tab-new-icon`），颜色一律 currentColor 继承。

### 验证（8899 + 完整 Chromium，desktop-full → pane-1 展开面板 → 打开文件 pane → ＋菜单）

- computed：tab 图标 13px、＋菜单 5 项均 16px svg、placeholder 图标 24×24 + 容器 `flex-direction: column`、toolbar 标题 `font-weight: 600`（两主题）✓
- 视觉（dark + light vision 复核）：预览=地球、计划=剪贴板、差异=纸页、终端=>\_、文件=折角纸页；空态 24px 图标上文案下居中；标题加粗；图标色跟随文字（light menu #565A60 / dark 浅灰不刺眼）✓；菜单快捷键无溢出（DOM 边界实测）
- 90 面板相关 vitest（panelToggleMenu / chatAppPanels / filePane）全绿 + webview type-check ✓

### 实现文件

- `src/components/PanelKindIcon.tsx`（新增）
- `src/components/DesktopPanelTabs.tsx`、`PanelEmptyState.tsx`、`PanelToggleMenu.tsx`、`PreviewPane.tsx`、`FilePane.tsx`
- `src/styles/DesktopPanelTabs.css`、`DesktopApp.css`、`FilePane.css`

---

## 0903 新基线第 1 轮（2026-09）：右侧面板 Tab 条区域对齐设计稿（背景/字号/图标）+ 终端工具栏图标统一

预览评论 3 条，均指向右侧面板头部（spec-first `bdb023c9` DesktopPanelTabs 重构后未纳入桌面色板的新组件）：
① `div.desktop-panel-tabs`「localhost:8899 计划 终端」——检查背景色、字号、图标大小、图标使用（Figma 13438:8119）
② `div.preview-pane-toolbar`「终端」——图标要保持一致（Figma 13383:4517）
③ 同「终端」区域——高度参考设计稿

### 设计源（Figma 权威 + codechat 落地）

- `13438:8119`（「界面打开后」面板帧）：tab 条 Header 44px 高、白底 #FFF + 下边框 #EBEEF5、pad 0 12；tab pill 26px 高 / r8 / pad 8,8,2,2 / gap 4，激活底 #F0F2F5，文字 14px（active #1F2329 500 / inactive #565A60 400），tab 内图标 16×16、关闭 16×16；tab 间 1px×16 竖分隔线 #DCDFE6；add/全屏 =「功能」icon-button 24×24
- codechat `InspectorPanel.vue`/`global.css` `.preview-tabbar` 同值实现：44px、pad 0 12、`.preview-tab` 26px/r-md(8)/pad 0 8、`+` 前 1px×16 `#DCDFE6` 分隔线（top 5 / left -5）、label 14px/22 / regular #565A60、active #1F2329 medium + 底 `--cc-fill` #F0F2F5、`.figma-icon-button` 24×24 / img 16 / hover `--cc-fill-hover`

### 修改前（spec-first DesktopPanelTabs 现状） vs 修改后

| 项                                      | 修改前                                    | 修改后（Figma/codechat）                                                                    |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| tab 条容器高                            | 34px、pad 0 6px                           | **44px**、pad 0 12px                                                                        |
| 浅色容器底                              | #F7F8FB / 边 #E4E7ED                      | **白 #FFF** / 边 **#EBEEF5**（深色保留 #181818 与 pane 一体）                               |
| tab 药丸                                | 24px 高、r12 胶囊、pad 0 4 0 8、文字 12px | **26px**、**r8**、**pad 0 8px**、**文字 14px/22**                                           |
| tab 激活态                              | color-mix(10% fg) 灰雾                    | light **#F0F2F5**/#1F2329、dark rgba(255,255,255,**0.12**)/#FFF                             |
| tab 未激活文字                          | --vscode-foreground（#202020/#ccc）       | light **#565A60**、dark **#9A9EA5**（14px/400）                                             |
| tab 图标                                | PanelKindIcon 13px                        | **16px**（Figma tab 内 16×16 实例，PanelKindIcon size 13→16）                               |
| tab 间分隔线                            | 无                                        | **1px×16 #DCDFE6**（dark rgba 白 0.2；`.desktop-panel-tab + .desktop-panel-tab::before`）   |
| 分隔线（tabs/add 间）                   | strip gap 2px                             | strip gap **8px**                                                                           |
| add 按钮                                | 22×22 / r4                                | **24×24** / r6（「功能」icon-button）                                                       |
| 全屏按钮图标                            | codicon-screen-full/normal                | **MaximizeIcon/UnmaximizeIcon**（HeaderIcons 既有 lucide 官方版，Figma icon_line/maximize） |
| hover 底色（tab 非激活/add/全屏/close） | vscode list-hover 蓝灰                    | 统一 **#EEF0F3**（light）/ 8% 白（dark）；**active:hover 保持 pressed 不漂移**              |
| 终端工具栏重启图标                      | codicon-debug-restart                     | **RefreshIcon**（与预览工具栏刷新同源 lucide svg，按钮 24×24 内 16px）                      |
| toolbar 区域高度                        | 各 pane toolbar 已 44px                   | 与 Figma Header/`.inspector-header` 44 一致，确认不改                                       |

### 验证（8899 完整 Chromium，desktop-full → 点击 localhost 链接开 preview → ＋菜单加终端/计划）

- computed 两主题：tabsBox 44px / pad 0 12 / light bg #FFF 边 #EBEEF5、dark #181818；tab 26px/r8/14px、激活 light #F0F2F5 / dark rgba(255,255,255,0.12)、未激活 light #565A60 / dark #9A9EA5；icon 16×16、close 16×16、add/fullscreen 24×24 ✓
- 真实 hover（Playwright mouse）：非激活 tab / add / 全屏 / close = #EEF0F3（light 验证由同规则）与 rgba(255,255,255,0.08)（dark 实测）；**active tab hover 保持 0.12 不漂** ✓
- 终端 pane toolbar：44px、dark 透明、重启按钮 24×24 + RefreshIcon svg 16×16、hover 8% 白 ✓
- vision 复核（浅色整页 vs Figma 13438:8119 渲染图）：白底 tab 条 + 细下边框、r8 圆角矩形 tab、14px 文字、16px 前导图标、tab 间 1px 竖线，与设计稿一致 ✓
- webview type-check + oxlint（新改动 0 警告；唯一 lint 错误在排除集 prototype/mockShared.ts 工具链既有问题）+ chatAppPanels/panelToggleMenu/terminalPane 73/74 通过（1 例 ExitPlanMode plan 面板 5s 超时待复查是否 flaky）

### 实现文件

- `src/components/DesktopPanelTabs.tsx`（PanelKindIcon 16、全屏 Maximize/Unmaximize）
- `src/components/TerminalPane.tsx`（重启 RefreshIcon）
- `src/styles/DesktopPanelTabs.css`（44px/r8/14px/16px/分隔线/gap/按钮 24）
- `src/styles/host-desktop.css`（0903 第 1 轮段：容器/文字/激活/hover 主题色）

### 追加（同轮）：多 tab 溢出时「＋」添加按钮跟随 tab、满了才固定

预览评论 `button.desktop-panel-tabs-add`（5 个「新预览」tab）：添加按钮需要始终在，现在不见了 → 修复后用户反馈「加号还是希望能跟随前面的标签，但如果标签满了，加号才会出现在固定位置」。

- 目标行为（浏览器标签栏语义）：tabs 放得下 → ＋ 紧跟最后一个 tab（inline）；tabs 溢出 → ＋ 移到 tab 条右端固定（pinned），不随滚动消失。
- 实现（`DesktopPanelTabs.tsx`）：`useLayoutEffect` 测量 `Σtab.offsetWidth + (n-1)*8 + 32(8gap+24btn)` vs strip `clientWidth` → `pinned` state；＋ 按钮双渲染位——`!pinned` 时作为 strip 末位 flex child 尾随，`pinned` 时渲染在 strip 与 `.desktop-panel-tabs-actions` 之间常驻；两个独立 ref，`ResizeObserver` 监听 strip 与各 tab（label 变宽也能触发）；判定用固定 32px 常量而非当前模式宽度，避免按钮换位时临界自激振荡；菜单锚定/`triggerRef` 按 `pinned` 取对应按钮。`DesktopPanelTabs.css` 仅更新按钮位置注释。
- 验证（2000×1100 完整 Chromium，desktop-full）：1 tab 时 ＋ x827 在 strip 内紧跟 tab（btnRight 851 < strip 右缘 1089）；加到 4 tab 溢出 → ＋ x1065 ≥ strip 右缘 1061，pinned 到全屏按钮（x1093）旁；逐个关 tab 回到 2 tab 放得下 → ＋ 回到 strip 内 inline（x933）。vision 复核两状态：溢出时 ＋ 在最右完整可见、较少时紧跟最后一个 tab 且右侧留白。type-check 通过。
- 实现文件：`src/components/DesktopPanelTabs.tsx`、`src/styles/DesktopPanelTabs.css`、本 docs。

### 追加（同轮）：预览地址栏改纯文字胶囊对齐 Figma 13438-7439（删前置图标 + 字号 14）

预览评论 `span.preview-pane-url`「`http://localhost:8899/`」：「这个地址前面不显示图标，字号等参考设计稿」（Figma 13438-7439）。

- 设计稿权威值（13438-7439「界面打开后」Header 379×44）：地址胶囊 Frame 26 高 / r8 / pad 0 8 / bg #F0F2F5，**内无前置图标**，文字 14px / line-height 22 / 400 / #1F2329；右侧 3 个「功能」icon-button 24×24。
- 修改（用户确认「删图标按稿」）：
  - `PreviewPane.tsx`：删地址胶囊内 `PanelKindIcon preview size=13`（上轮「这里也是预览图标」加的 globe 实例）与相关注释。
  - `DesktopApp.css`：`.preview-pane-url` 高 22→**26**、font 12→**14**、line-height 22、border-radius 11→**8**、补 box-sizing（胶囊现与编辑态 `.preview-pane-address` 26/r8/14 完全同几何，显示↔编辑切换不再跳动）；删 `.preview-pane-url-icon` 规则。
- 验证（2000×1100 完整 Chromium 两主题）：胶囊 computed light bg #F0F2F5/#1F2329、dark rgba 白 6%/#E6E6E6，两主题均 26 高 / 14px / pad 0 8 / **icon=null**；vision 复核 light/dark 胶囊纯文字、无前置图标、字号与高矮圆角同设计稿；webview type-check 通过。
- 实现文件：`src/components/PreviewPane.tsx`、`src/styles/DesktopApp.css`、本 docs。

### 追加（同轮）：＋ 添加 / × 关闭按钮换「功能」icon-button 官方矢量

预览评论 `button.desktop-panel-tabs-add`：添加的按钮、删除的按钮，参考设计稿来实现（不要自动化测试、用户人工走查）。

- 设计稿：两按钮同属「功能」icon-button 组件集（13383:4517，24×24 容器内 16 图标，常态 #565A60）。添加 = 圆头实心加号 Union `13383:21135`（13×12 viewBox）；关闭 = 圆头实心 X Union `13440:12468`（9×9 viewBox）。原实现是 codicon 字体（codicon-add / codicon-close），非官方形状。
- 修改（官方 SVG 直导内嵌，fill → currentColor 随主题）：
  - `DesktopPanelTabs.tsx`：文件内新增 `AddTabGlyph`/`CloseTabGlyph`（官方 path），替换 tab ×（1 处）与 ＋（inline + pinned 两处共 2 个实例）的 codicon；删除 codicon 字体引用。
  - `DesktopPanelTabs.css`：删 `.desktop-panel-tab .codicon` 死选择器；svg block 化消基线偏移。
  - `host-desktop.css`（0903 段补）：＋/× 图标色常态 light #565A60 / dark #9A9EA5、hover 加深 #1F2329 / #FFF（容器 hover 底 #EEF0F3 / 8% 白不变）。
- 验证：webview type-check 通过；无 codicon 残留。用户将人工走查（本轮不跑 UI 自动化）。
- 实现文件：`src/components/DesktopPanelTabs.tsx`、`src/styles/DesktopPanelTabs.css`、`src/styles/host-desktop.css`、本 docs。

### 追加（同轮）：＋ 下拉菜单去掉选中态（checklist → 纯操作菜单）

预览评论 `div.panel-toggle-menu-item`「预览⇧⌘P」：这个下拉菜单不应该有选中状态。

- 现象（探针截图定位）：tab 条 ＋ 菜单在「计划/终端」等单实例面板已开时，这些项带 `panel-toggle-menu-item--active` 选中底（light #F0F2F5 / dark 12% 白）+ `aria-checked=true`。＋ 菜单语义是「新建/打开面板」，并非面板勾选菜单（header 面板按钮那个才是勾选清单），preview 因 noCheckKinds 免勾、其余四项却按已开状态打了勾。
- 修改：`DesktopPanelTabs.tsx` 菜单加 `checklist={false}`（PanelToggleMenu 已有 plain-menu 模式）——所有项一律无勾、无 active 底、role=menuitem 无 aria-checked；删除已无用的 `noCheckKinds` 传参。
- 验证：重跑探针——计划/终端已开时五项均无 `--active`、`aria-checked=null`；webview type-check 通过；panelToggleMenu/ChatApp panels 相关 34 用例通过。
- 实现文件：`src/components/DesktopPanelTabs.tsx`、本 docs。

### 追加（同轮）：非浏览器 pane 工具栏标题字号 12 → 14px

预览评论 `span.desktop-panel-toolbar-title`「计划」：「这里标题区域字号应该是14px，差异等其他界面也是」。

- 修改：`DesktopApp.css` `.desktop-panel-toolbar-title`（计划/差异/终端/文件 pane toolbar 共用标题类）font-size 12px → **14px**，font-weight 600 保留。
- 实现文件：`src/styles/DesktopApp.css`、本 docs。（用户人工走查，本轮不跑自动化。）

### 追加（同轮）：差异 pane 刷新按钮换 RefreshIcon（与预览/终端一致）

预览评论 `i.codicon.codicon-refresh`「差异」：「差异等等，这里的刷新按钮，和预览的也要保持一致」。

- 修改：`DiffPane.tsx` 工具栏刷新按钮 codicon-refresh（codicon 字体）→ **RefreshIcon**（HeaderIcons lucide svg，与预览/终端工具栏同源 16px currentColor），刷新中旋转改为自绘 `is-spinning` 动画（codicon-modifier-spin 仅作用于字体图标）；`DesktopApp.css` 增 `.preview-pane-icon.is-spinning` + keyframes。
- 实现文件：`src/components/DiffPane.tsx`、`src/styles/DesktopApp.css`、本 docs。（用户人工走查，本轮不跑自动化。）

### 追加（同轮）：空白预览 tab 全屏宽度不伸展

预览评论 `div.preview-tab-new`「在上方地址栏输入网址开始预览」：「新建预览后，点击全屏，预览区域宽度没有响应」。

- 根因：空白预览的出口多包了一层 `div.preview-pane-empty-wrap`（`ChatApp.tsx` 空态分支，inline `width: panelWidth` 把空态撑到受控宽度）。全屏 CSS 只覆盖了内层 `.preview-pane` 为 `width:100%!important`，外层 wrap 的 inline width 未被覆盖，空态面板宽度因此仍钉在 panelWidth、不随全屏伸展（有 URL 的预览直接是 `.preview-pane` 自身，无此层，故正常）。
- 修改：`DesktopApp.css` 全屏选择器补 `.preview-pane-empty-wrap`（与 `.preview-pane` 同为 `width:100% !important`）。
- 实现文件：`src/styles/DesktopApp.css`、本 docs。（用户人工走查，本轮不跑自动化。）

---

## 0903 新基线第 2 轮（2026-09）：AskUserQuestion 模块字号对齐 codechat Question dialog

预览评论：「AskUserQuestion 模块的字号等是否符合规范，现在看比其他模块要小」（锚点 `div.virtual-spacer` / `#messagesContainer`）。

### 现状 vs codechat 落地

AskUserQuestion 两处呈现均沿用 IDE 时代 12px 字号，低于桌面 14px 基准（--vscode-font-size: 14px / --cc-font-size-md）：

| 元素                                 | 修改前      | codechat Question dialog 权威      | 修改后（desktop） |
| ------------------------------------ | ----------- | ---------------------------------- | ----------------- |
| `.question-header-chip`（问题文字）  | 13px/600/18 | question-text 14px/500/22          | **14px/500/22**   |
| `.question-text`                     | 13px/600/18 | 同上                               | **14px/500/22**   |
| `.option-label`（选项主文字）        | 12px/500/16 | question-option-title 14px/500/22  | **14px/500/22**   |
| `.option-description`（选项副文案）  | 12px/400/16 | question-option-desc 12px（xs）/20 | 12px/**20**       |
| `.recommended-tag`                   | 11px        | —（xs 档）                         | **12px**          |
| `.other-text-input`（「其他」输入）  | 12px/16     | question-custom-input 14px/22      | **14px/22**       |
| `.ask-user-result-q`（会话内已答 Q） | 12px/500/16 | —                                  | **14px/500/22**   |
| `.ask-user-result-a`（会话内已答 A） | 12px/500/16 | —                                  | **14px/400/22**   |

说明：字重按 codechat 取 500（medium）；辅助描述保留 xs=12px（规范本身即小号，仅行高对齐 20）；已答摘要行距桌面正文档 14px，问题 500 / 答案 400 区分层次。

### 实现文件

- `src/styles/host-desktop.css`（追加 0903 第 2 轮段，`[data-host="desktop"]` 限定，IDE 不受影响）

### 验证

- 未走自动化（用户 2026-09-03 约定人工走查）；HMR 已生效，请在 8899「工具状态演示」用例查看 AskUserQuestion 实时卡片（问题 + 选项）与提交后的已答摘要

---

## 0903 新基线第 3 轮（2026-09）：AskUserQuestion 已答答案框 & 运行中命令输入行圆角统一 12px

预览评论 2 条：
① `span.ask-user-result-a`「Redis Cluster」「圆角也要和其他模块保持一致，这里应该是12px，再检查其他模块是否有类似不一致的问题」
② `div.bash-command-input`「npm run build」「比如这里」

### 盘点与修改

第 34/35 轮已将工具/消息区卡片统一为 12px（--cc-radius-lg）：`.write-preview-box`、`.markdown-content pre`、`.diff-viewer-container`、`.bash-command-unified`（外框）。扫描发现遗漏面：

| 元素                                    | 场景                                          | 修改前 | 修改后                                                              |
| --------------------------------------- | --------------------------------------------- | ------ | ------------------------------------------------------------------- |
| `.ask-user-result-a`                    | AskUserQuestion 已答答案框（Figma 2261:9773） | 6px    | **12px**                                                            |
| `.tool-container > .bash-command-input` | Bash 运行中/无输出时的独立命令输入行          | 6px    | **12px**（子选择器仅命中独立行，不影响 unified 内 radius:0 输入行） |
| `.lsp-output`                           | legacy LSP 输出框                             | 4px    | **12px**                                                            |

其余块面核对无遗漏：tool-error 为纯文本非卡片、result-raw 无框、confirmation-command r8 属弹窗内容非消息卡片。

### 实现文件

- `src/styles/host-desktop.css`（0903 第 3 轮段）

### 验证

- 未走自动化（用户 2026-09-03 约定人工走查）；HMR 已生效，请在 8899「工具状态演示」用例核对：AskUserQuestion 已答摘要的答案框圆角、`npm run build` 运行中命令行圆角，与旁边的 bash 完成态（unified 12px）一致

---

## 0903 新基线（续批）：右面板分割线 & 拖拽区延伸覆盖标签条

预览评论 `div.desktop-panel-tabs`「localhost:8899」：「预览打开后，拖拽区域和分割线没有覆盖到这个标签的区域」。

- 根因：面板 tab 化后，44px 标签条（`.desktop-panel-tabs`）位于 pane（`.preview-pane`）上方，而左分割线（pane 的 `border-left`）与拖拽条（`.preview-pane-drag-handle`，`top:0` 从 pane 顶起）都在 pane 内部 → 标签条高度段既无分割线也不可拖拽，视觉上整条线在标签处断开。
- 修改（纯 CSS）：
  - `DesktopPanelTabs.css`：`.desktop-panel-tabs` 补 `border-left: 1px solid var(--vscode-panel-border)`（与 `.preview-pane` 同色 #e4e7ed）。标签条与 pane 同宽同左缘、上下紧邻，两段线首尾相接成贯穿整列（标签条 + 面板体）的连续分割线。
  - `DesktopApp.css`：`.preview-pane-drag-handle` `top: 0 → -45px`（44px 标签条 + 1px 底边），拖拽命中区与 hover 分隔条从面板顶部一路连续到底，可在标签条左缘直接拖宽/收窄面板。
- 说明：五个 pane（预览/差异/文件/计划/终端）共用 `.preview-pane` 类与同一 handle，一处改动全部生效；标签条存在是 pane 渲染的前提，故 -45px 上延不越界。
- 实现文件：`src/styles/DesktopPanelTabs.css`、`src/styles/DesktopApp.css`、本 docs。（用户人工走查，本轮不跑自动化。）

---

## 0903 新基线第 4 轮（2026-09，r2 分支首轮）：账户卡片用量显隐按钮收起态图标 → 官方「额度」图标

预览评论：`button.account-card-collapse-btn`「这个图标替换成设计稿中的额度图标」（Figma 链接 node 13383:4517）。

### 设计源

「功能」图标集 COMPONENT_SET `13383:4517` 内 variant「额度」`13648:3600`（normal，24 artboard）：表盘外圈 r6.56 + 左右指示弧 + 指针 + 轴心，stroke #565A60 / w1.4 / round（与面板图标族同 spec）。SVG 直导后 #565A60 → currentColor。

### 修改

- `src/components/HeaderIcons.tsx`：新增 `QuotaIcon`（官方矢量内嵌，24×24，默认 className header-icon）。
- `src/components/AccountCard.tsx`：用量显隐按钮收起态原 `codicon codicon-dashboard` → `<QuotaIcon />`；展开态 chevron-up 保留。

范围确认（AskUserQuestion 澄清）：账户卡 spec（v3 定稿，后并入 desktop-account-and-settings.md「账户卡片」）双图标语义——展开态 chevron-up（提示可收起）、收起态仪表盘（提示可再展开）；用户选择「仅收起态换官方额度图标」，chevron 交互提示保留。

### 验证

- 未走自动化（用户约定人工走查）；HMR 已生效。请在 8899 桌面端侧栏账户卡点显隐按钮收起用量区，核对收起态图标 = 设计稿表盘额度图标（light/dark 均 currentColor 跟随），展开态仍为 chevron-up。

---

## 0903 新基线第 5 轮（2026-09，r2 分支）：账户卡显隐按钮图标过小/热区失真 → 修复 padding 压缩

第 4 轮评论跟进：`button.account-card-collapse-btn`「你参考下设计稿的实现方式，现在图标很小，热区应该也不太对，仅看图标这里就好」（Figma node 13498:17085）。

### 设计稿对比

Figma 13498:17085 账户行（13498:17131，235×41）：右侧「功能」icon-button 实例（13651:3690 @x211,y13）= 24×24 按钮、内含 16×16 icon canvas、glyph（额度表盘）约 13×13。即按钮热区 24×24，glyph 视觉 ~13px 居中。

### 根因

`.account-card-collapse-btn` 未重置 `padding` → Chrome UA 对 button 默认 `padding: 1px 6px`（`border-box` 下内容区从 24px 被压到 12px）→ 24×24 的 svg 作为 flex item 被 flex-shrink 成 12×24，glyph 也随之压扁变小；视觉图标偏移、与热区不匹配，观感即「图标很小、热区不对」。

### 修改（AccountCard.css）

`.account-card-collapse-btn` 补 `padding: 0`（显式重置 UA 默认），内容区恢复满 24px。收起态官方额度 svg 回到 24×24 渲染（glyph 直径按 viewBox 比例 ≈13px，与设计稿一致）；展开态 chevron-up 同样从被压状态恢复 16px。

### 验证

- 未走自动化（用户约定人工走查）；仅做了计算样式诊断：收起态 svg 24×24（修复前 12×24）、按钮 padding 0px、热区 rect 24×24；展开态 chevron 16px。请在 8899 桌面端账户卡收/展用量区肉眼核对图标大小与居中。

---

## 0903 新基线（r2 续批）：元素选取激活框黑色 → 焦点蓝

预览评论 `button.preview-pane-button`「预览」：「元素选取激活后，操作会出现框框，现在框框变成黑色了，我希望是蓝色的」。

- 根因：picker 高亮框（guest 内 `__wave-picker-highlight` 的 2px outline）颜色取 `palette.accent`，host 端 `accent` 读 `--vscode-button-background`——桌面设计系统已把主按钮中性化（light `#1f2329` 炭黑 / dark `#3d424a` 深灰），于是选取高亮框跟着变黑。
- 修改：
  - `host-desktop.css`：桌面 light/dark root 主题块补 `--cc-text-link` token（Figma cc 链接蓝 light `#2f5edb` / dark `#4daafc`，此前散落硬编码在各链接规则），供 host 侧取样。
  - `PreviewPane.tsx`（host）：`readPalette()` 新增 `accentOutline` = `--cc-text-link`（插件端回退 `--vscode-textLink-foreground`）——用户确认高亮框用**链接蓝**而非 vscode focusBorder 色。
  - `pickerPreload.ts`（guest）：高亮框 outline 改取 `accentOutline ?? accent ?? "#0e639c"`。
  - picker 浮层主按钮/链接仍用 `accent`（桌面炭黑主按钮规范不受影响），仅元素高亮框改链接蓝。
- 验证：desktop type-check 通过；pickerPreload 单测 11 个全过（旧 palette 无 accentOutline 时回退 accent，行为不变）。（用户人工走查，本轮不跑 UI 自动化。）
- 实现文件：`packages/desktop/src/main/pickerPreload.ts`、`packages/webview/src/components/PreviewPane.tsx`、`packages/webview/src/styles/host-desktop.css`、本 docs。

---

## 0903 新基线第 6 轮（2026-09，r2 分支）：套餐用量进度条 深色模式可读性修复

预览评论：`div.account-card-usage-inline`「套餐用量 76%」「深色模式下进度看不清，需要重新计算下这个进度条在深色模式下如何显示」。

### 深色根因

浅色设计稿权威（Figma Sidebar「任务导航」Variant3 / Bar 组件 6423:61933）：进度条 fill = 炭黑 `#1F2329`、track = `#EBEDF0`，白底上高对比。深色帧组件库未画。

wave 深色下 fill 原走 `--vscode-button-background`（desktop dark 主按钮炭灰 `#3D424A`，rgb 均值 ≈67），而 track 原为 `color-mix(descriptionForeground 25%, transparent)`（深色 ≈12% 白 ≈ #353535，rgb 均值 ≈53）——**fill 与 track 亮度几乎相同**，76% 进度段在深底 #181818 上无法区分（此前的「炭灰按钮 = 进度填充」在浅色成立是因为浅色按钮即炭黑，深色下炭灰按钮与 12% 白轨道同属低亮度，语义失效）。

### 修改（host-desktop.css，仅深色）

| 元素                               | 修改前（深色）               | 修改后（深色）                                                                 |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `.account-usage-bar` track         | 25% 灰混透明（≈12% 白）      | `rgba(255,255,255,.12)`（明示，wave 深色低强调惯例，同 textBlockQuote-border） |
| `.account-usage-bar-fill`          | `#3D424A`（与 track 同亮度） | `#9A9EA5`（强调浅灰，同 compress-context-ring fill / toolbar-icon dark 族）    |
| `.account-usage-bar-fill.is-empty` | `--vscode-errorForeground`   | 不变（耗尽红保留，desktop dark errorForeground #F85149）                       |

对比度复核（sRGB，底 #181818）：fill #9A9EA5 ≈ 6:1、与 track ≈ 4:1 → 进度段一眼可读；track 仅 1.4:1 保持低调槽位。percent 文本用 descriptionForeground（深色 #9D9D9D ≈5:1）无需改。

### 验证

- 未走自动化（用户约定人工走查）；仅计算样式诊断：dark 下 track `rgba(255,255,255,0.12)`、fill `rgb(154,158,165)`、fill 宽 76%；light 下 fill `#1F2329`（同设计稿）不变。请在 8899 桌面端深色用例核对「套餐用量」进度条填充/轨道对比，及 0% 耗尽红色提示。

---

## 0903 新基线第 7 轮（2026-09，r2）：账户卡用量常驻区对齐设计稿 13651:4911（图标/字号/字体颜色）

预览评论：`div.account-card`「套餐用量76% / API 余额 …」（Figma 链接 13651:4911，Frame 1321327580 画布，含三实例侧栏对比图）。「这个区域参考这个设计稿来实现，主要看图标、字号、字体颜色等信息」。

### 设计稿权威值（浅色帧）

| 元素                      | 设计稿                                            |
| ------------------------- | ------------------------------------------------- |
| 套餐用量 / API 余额 label | 12px/500/#1F2329                                  |
| 用量百分比（48%）         | 12px/500/**#1F2329**（同正文色，非灰）            |
| API 金额 ¥                | 12px/**500**/#1F2329                              |
| Bar                       | 高 **6px**、胶囊、track **#E6E8EB**、填充 #1F2329 |
| ⓘ 明细钮                  | 16px 官方 info 图标、灰点 **#8B8F95**             |
| 显隐按钮（chevron/额度）  | **32×32** icon-button（内 16 canvas）             |

### 改动（host-desktop.css，全部 [data-host=desktop] 限定，IDE 插件端不受影响）

- `.account-card-collapse-btn` 24→**32×32**（用户确认按本帧，替代第 4/5 轮依据旧帧 13498:17085 的 24 规格；glyph 绝对尺寸不变：QuotaIcon svg 24×24 内表盘 13.1px 同稿、chevron codicon 16px = 稿内 16 canvas）；圆角 4→**6px**（对齐功能 icon-button hover 组件 13383:4723/4726 的 r6 底色，与 32×32 尺寸配套）。
- `.account-usage-bar`：高 4→**6px**、圆角 2→3px；浅色 track → **#E6E8EB**（fill #1F2329 本已同稿）。**深色配色用户确认维持第 6 轮**（track 12% 白 / fill #9A9EA5），仅高度统一 6px。
- `.account-usage-percent`：浅色正常态灰 → **#1F2329**（仅 light；耗尽红 `.is-empty` 保留，dark 灰 #9D9D9D 维持）。
- `.account-usage-value-text`：字重 400 → **500**（light/dark 同）。
- ⓘ：codicon 字形 12→**16px**；浅色钮色 → **#8B8F95**、深色 #9A9EA5（对齐 16px 官方 info 图标观感）。

### 验证

- 未走自动化（用户约定人工走查）；仅计算样式诊断：light 下 percent `rgb(31,35,41)`、金额 w500、bar 6px/r3/bg `#E6E8EB`、fill `#1F2329`、显隐钮 32×32/p0/r6、ⓘ 16px/#8B8F95；dark 下 percent #9D9D9D、bar 6px/12% 白、fill #9A9EA5、钮 32×32、ⓘ 16px/#9A9EA5（第 6 轮配色不变）。请在 8899 桌面端浅色/深色核对账户卡：显隐钮热区 32、76% 数字炭黑、金额 w500、进度条 6px、ⓘ 16px。

### 评论跟进（同区域）：展开态 chevron / ⓘ 换官方矢量 + ⓘ hover 只变色不显底色

用户核对后评论：「额度展开和 info 的图标没有换，info 图标 hover 状态是颜色发生改变，不显示背景」——展开态按钮仍是 codicon-chevron-up 字形、ⓘ 仍是 codicon-info 字形；且 ⓘ hover 出现底色背景（不应有）。

- `HeaderIcons.tsx`：新增 `ChevronUpIcon`（官方 chevron 13651:4244，24 artboard stroke 矢量）与 `ApiInfoIcon`（官方 info 13651:3900，16 artboard：外圈 + 「i」弧 + 中心点；同名义遗留旧 InfoIcon 无引用，保留不动），均 currentColor。
- `AccountCard.tsx`：展开态 `codicon codicon-chevron-up` span → `<ChevronUpIcon />`；ⓘ `codicon codicon-info` `<i>` → `<ApiInfoIcon />`（16px svg）。
- `host-desktop.css`：ⓘ hover/focus 补 `color: var(--vscode-foreground)` 并置背景透明——host 静态色 (0,3,0) 会压过 base `:hover` (0,2,0)，须在 host hover 规则显式变色；删除已失效的 `.account-api-info-btn .codicon` 字号规则。
- 验证（计算样式）：展开态按钮 svg viewBox 24（官方 chevron）、收起态 viewBox 24 + 2 circle（额度表盘）；ⓘ 按钮 svg viewBox 16；hover light #8B8F95→#202020、dark #9A9EA5→#CCCCCC，两态背景均透明。请人工走查展开/收起图标切换与 ⓘ hover。

### 评论跟进（同轮）：显隐钮圆角对齐 6px + 「套餐用量」到进度条间距加大

用户核对后两条：

1. 「再检查额度图标背景圆角是不是 6px」——查 Figma 功能 icon-button hover 组件 13383:4723/4726 确认 hover 底色圆角 **r=6**（此前 base 圆角仅 4px）。`host-desktop.css` `.account-card-collapse-btn` 32×32 块补 `border-radius: 6px`（hover 底色形状随按钮圆角）。
2. 预览评论 `div.account-usage-title`「套餐用量到进度条的间距再大一些」——Figma 13651:5041（Frame 1321327573）文本行底 y=5510 → Bar 顶 y=5516 = **6px**，base `.account-usage-section` 列 gap 仅 4px。host 补 `.account-usage-section { gap: 6px; }`（该 section 只含标题行与进度条，不影响 API 余额行距）。

---

## 0903 新基线第 8 轮（2026-09，r2）：会话状态页收起导航后顶栏补展开/新对话钮 + 分割线

预览评论 `button.session-board-back`「返回当前会话」：「会话状态页面打开后收起左侧导航，展开左侧导航图标、新对话图标依旧需要展示，和返回当前会话之间有分割线，参考设计稿实现」（Figma 13561:39312）。

### 设计稿（13561:39312 Header）

顶栏行从左到右：**「展开侧边栏」功能钮（24×24）→ 「新对话」功能钮（24×24）→ 1×16 分割线（#DCDFE6）→ 「返回当前会话」按钮**，钮间距统一 8px。语义 = 侧边栏收起后常用入口上移保留在页面顶栏。

### 修改

- `SessionBoard.tsx`：新增可选 props `collapsed / onExpandSidebar / onNewSession`；`collapsed` 时顶栏左起渲染「展开侧边栏」（SidebarExpandIcon，官方 13383:4605）与「新对话」（NewSessionIcon）两个功能钮 + 分割线，再接原「返回当前会话」。
- `ChatApp.tsx`：构造 sessionBoard 处传入 `collapsed={sidebarCollapsed}`、`onExpandSidebar={() => handleSidebarCollapsedChange(false)}`、`onNewSession={handleDesktopNewSession}`（展开态侧边栏本身有这些入口，顶栏不重复）。
- `SessionBoard.css`：`.session-board-icon-btn`（24×24 / r6 / #565A60，hover #F0F2F5）、`.session-board-toolbar-divider`（1×16 #DCDFE6）、toolbar `gap:8px`，并补 dark 覆盖（图标 #9A9EA5、hover 8% 白、分割线 12% 白）。
- 验证：webview type-check 通过（未走 UI 自动化）。（用户人工走查，本轮不跑自动化。）
- 实现文件：`src/components/SessionBoard.tsx`、`src/components/ChatApp.tsx`、`src/styles/SessionBoard.css`、本 docs。

### 追加（同轮）：收起态 header leading 拿掉「新建对话」图标钮

预览评论 `button.header-button`（收起侧边栏后 chat header 左起第 2 个钮）：「拿掉新对话这个图标和功能」。

- 修改：`ChatApp.tsx` `collapsedLeading` 删除 Tooltip「新建对话」钮（原行为 = 清空当前会话，`handleClearChat`），只保留「展开侧边栏」+ 1×16 分割线（`header-collapsed-divider` 保留，仍隔开按钮与 header 标题）；同步移除 `NewSessionIcon` import、更新注释。
- 实现文件：`src/components/ChatApp.tsx`、`src/styles/ChatHeader.css`（注释）、本 docs。（用户人工走查，本轮不跑自动化。）

### 追加（同轮）：会话状态页顶栏同样拿掉「新对话」钮

预览评论 `button.session-board-icon-btn`（会话状态页收起导航后顶栏第 2 个钮）：「这里也拿掉」。

- 修改：`SessionBoard.tsx` 顶栏 collapsed 组删除「新对话」功能钮（`NewSessionIcon` + Tooltip），仅保留「展开侧边栏」+ 分割线；移除 `onNewSession` prop 与 `NewSessionIcon` import，`ChatApp.tsx` 构造处同步删去 `onNewSession` 传参。
- 实现文件：`src/components/SessionBoard.tsx`、`src/components/ChatApp.tsx`、本 docs。（用户人工走查，本轮不跑自动化。）

---

## 0903 新基线第 9 轮（2026-09，r2）：ⓘ API 余额明细气泡卡对齐设计稿 13651:4864 + 警示色主题变量审计

预览评论附 Figma 13651:4864（Frame 1321327547，账户卡上方悬浮的「API 余额」明细卡）：「参考这个设计稿，调整下 hover 弹出卡片的阴影圆角什么的，一些琥珀、红色这种警示色检查是否是主题变量中的颜色」。

### 设计稿权威值（13651:4864，浅色帧）

| 项                  | 设计稿                                       | 改前                                       |
| ------------------- | -------------------------------------------- | ------------------------------------------ |
| 圆角                | **r12**                                      | r6                                         |
| 描边                | 1px **#EBEEF5**                              | widget-border                              |
| 投影                | **0/0/12 rgba(0,0,0,.12)**（无偏移柔和投影） | 0 4px 12px rgba(0,0,0,.42)                 |
| 背景                | #FFFFFF                                      | panel-background（浅色同白）               |
| 内边距              | 9（外 235×78 − 内 217×60 四边同距）          | 10×12                                      |
| 标题                | 12px/**500**/#1F2329                         | 600/foreground                             |
| 行标签「已用/剩余」 | 12px/400/**#565A60**                         | descriptionForeground（浅色 #606060 偏深） |
| 金额                | 12px/**500**/#1F2329                         | foreground w400                            |

### 改动（host-desktop.css，desktop 限定）

- 几何：`.api-quota-popover` `padding: 9px`、`border-radius: 12px`（深浅色统一，几何不受主题影响）。
- 浅色帧：白底 + `border: 1px solid #EBEEF5` + `box-shadow: 0 0 12px rgba(0,0,0,.12)`；标题 w500/#1F2329、行标签 #565A60、金额 `:not(.is-empty)` #1F2329 w500（耗尽红 `.is-empty` 不被覆盖）。
- 深色无设计帧：维持 base 的 vscode token 方案（panel 底 / widget 描边 / 强投影），只统一几何；文字沿用 foreground/descriptionForeground token。

### 警示色审计结论（琥珀/红）

账户卡用量区与气泡的琥珀、红色**全部走主题变量，无写死警示色**：

- 琥珀：`--vscode-editorWarning-foreground`（light #BF8803 / dark #CCA700）——`.account-usage-value.is-warning` 金额、`.api-popover-warn.is-warning`「余额不足20%…」。
- 红：`--vscode-errorForeground`（light #AD0707 / dark #F85149）——`.account-usage-percent.is-empty`、进度条 fill `.is-empty`（第 6 轮 host 深色规则亦经该 token）、`.account-usage-exhausted`、`.account-usage-value.is-empty`「已用完」、`.api-popover-amt.is-empty`、`.api-popover-warn.is-empty`。
- CSS 中出现的 `#f14c4c / #d18616 / #f85149` 仅为 `var(--xxx, 兜底)` 的 fallback（IDE 端无主题时的缺省），桌面 host 恒由 theme-base-light/dark.css 的 token 实际取值。
- 另注：mock 端曾把 `apiQuota` 写成 `{total,used}`（组件读 `{limit,used}`）导致预览 ¥NaN，与组件色无关；本区域校验用用例已按 `limit` 字段构造。

---

## 0904 新基线第 1 轮（feat/0904-new-base-r1）：权限模式下拉菜单固定 164px

预览评论 `ul.permission-mode-menu`（「修改前询问/自动接受/修改跳过权限/确认计划模式」下拉）：「这个下拉菜单宽度调整为164px」。

- 修改：`src/styles/host-desktop.css` `[data-host="desktop"] .permission-mode-menu` 由 `min-width: 168px` 改为 `width: 164px; min-width: 164px; box-sizing: border-box`（padding 8px + border 1px 计入外框，整体恰 164px）；dark 覆盖块只改颜色、宽度共用。
- 实现文件：`src/styles/host-desktop.css`、本 docs。（用户人工走查，本轮不跑自动化。）

---

## 0904 第 2 轮（feat/0904-new-base-r1）：diff 展示窗口去除鼠标点击聚焦框

预览评论 `div.diff-viewer-container`（tool diff 内容区）：「这个窗口不应该有选中状态，和其他的展示窗口保持一致」。

- 根因：`.diff-viewer-content` 带 `tabIndex={0}` 且样式用 `:focus`（鼠标点击即触发），点击 diff 区域后整容器出现 1px `--vscode-focusBorder` 描边，形似选中；bash/write/pre 等展示窗口无 tabIndex/无聚焦描边。
- 修改：`src/styles/DiffViewer.css` `.diff-viewer-content:focus` → `:focus-visible`（与全项目惯例一致：鼠标点击不显示框、键盘 Tab 聚焦仍保留焦点指示；桌面/IDE 两端同一基础样式）。
- 实现文件：`src/styles/DiffViewer.css`、本 docs。（用户人工走查，本轮不跑自动化。）

---

## 0904 第 3 轮（feat/0904-new-base-r1）：会话看板卡高 72 + 顶栏通栏 44 + 列容器圆角 r12 + 空态 14px

预览 CF-02（P2 · A · 已确认偏差）「会话卡片缺失 1px 描边 / 高 70 vs 72」+ 设计稿帧 `13498:16821` 对照评论（返回区通栏、卡片与列容器圆角、空态字号）。

- **CF-02 卡高对齐（Figma Container 13561:39327：外高 72 = 边框 2 + 内距 24 + 内容 46）**：`.session-card` gap 2→0、`.session-card-title` 补 `line-height: 26px`、`.session-card-status` 补 `line-height: 20px`（Figma 行高 26/20）；描边本就在位（1px #ebeef5，暗色 12% 白），hover 不再加深边框色（仅阴影，避免与常驻描边叠硬边）。实测两主题外高均 **72px**（1440 与 994 宽）。
- **顶栏通栏贴顶（Figma Header 行 44px 全宽，贴帧顶）**：`.session-board` padding 由 `16px` 改 `0 16px 16px`；`.session-board-toolbar` `margin: 0 -16px; padding: 0 8px; height: 44px`（box-sizing 含底描边 1px #ebeef5，首元素距左 8px）；`.session-board-header` / `.session-board-columns` 各 `margin-top: 16px`。几何对照 13498:16821 全中：toolbar 通栏 y0 h44、列头 y108 h48、列体 y156 h728、底留 16。
- **列容器圆角（Figma 列头/列体圆角绑定与卡片同款变量 `13363:28` = r12）**：`.session-board-column-header` `6px 6px 0 0` → `12px 12px 0 0` 且固定 `height: 48px`（Figma 列头 48，count 文本行框 24 撑起）；`.session-board-column-body` `0 0 6px 6px` → `0 0 12px 12px`；相接处直角。
- **空态字号（评论 2026-09：`div.session-board-empty` 暂无会话）**：12px → **14px**。
- 实现文件：`src/styles/SessionBoard.css`、本 docs。（用户人工走查，本轮不跑自动化。）

---

## 0904 第 4 轮（feat/0904-new-base-r1）：全局字重 token 化 + 权限按钮走查修正

用户提出对话流工具名等维持 600（semibold）、界面其它加粗 500（medium）、正文 400（regular），绑定 Figma `--cc-font-weight-*` 语义变量统一管理；组内归类由用户逐项在 8899 人工点名裁定。仅改 `host-desktop.css`（base 文件写死值不动，IDE 端不受影响），`font-weight: var(--cc-font-weight-<档>, 原值)` fallback 双保险。

### 分组落地（用户裁定）

- 新增 token：`:root[data-host="desktop"]` 定义 `--cc-font-weight-regular: 400 / -medium: 500 / -semibold: 600`（与主题无关）。
- **① 对话流工具名 → semibold 600（等值）**：`.tool-block`（全部工具 header 行）、`.write-tool-label`、`.reasoning-title`。
- **② 界面/面板标题类 → medium 500**（用户逐项点名，追加于「②-medium」组）：`.header-title`（顶栏，就地改）、账户卡 `.account-usage-title / -percent / -label / -value-text`、`.account-card-name`、`.session-card-title`、`.desktop-panel-tab.active .desktop-panel-tab-label`、`.desktop-session-group-name`、`.permission-mode-item`（权限下拉全部选项文案）、`.user-content`（用户消息正文）、`plan/file/diff/terminal/empty` 的 `.preview-pane-url` 面板标题（就地改）。部分本即 500（等值 token 化），部分由 600/400 提到 500。
- **③ 角标/状态 chip → medium 500**：`.account-card-avatar`（头像首字母）、`.api-popover-title`、mermaid `.zoom-info`、`.desktop-remote-browser-mark`（700→500）。
- **④ markdown/内容语义粗体 → semibold 600**：`.markdown-content strong/b/h5/h6/th`、`.suggestion-item.kb-option .suggestion-name`。
- **⑤ 原 bold 700 → 统一 semibold 600**：`.diff-prefix/.diff-chunk-prefix`、`.button-badge`、`.image-type`、`.suggestion-highlight`、`.todo-status-icon`、`.btw-panel-prefix`、mermaid `.close-btn`、`.file-pane .hljs-strong`。
- **正文 normal 重置并入 regular（值不变）**：`.plugin-version/-scope/-status-tag`、`.recommended-tag`、`.compact-params`、`.bash-command(-output)`、`.lsp-output`、`.tool-result-inline`、`.codicon`。

### 会话名两态（点名修正）

- 选中（`.desktop-session-item--current`）会话标题 medium 500；
- 未选中 `.desktop-session-title` → regular 400 不强调（用户：没选中不要加粗）。

### 权限模式按钮（走查评论）

- 「跳过权限确认」`.permission-mode-select.mode-bypassPermissions`：红色警示保留、字重改 regular 400（原 base bold 700；用户：选择完成后文案不要加粗，与其它模式一致）。
- 模式按钮底色触发 `:hover, :focus` → `:hover, :focus-visible`，并显式 `:focus { background: transparent }` 覆盖 base——鼠标切换选择后不再残留 hover 底色，键盘 Tab 聚焦仍显示焦点底色（dark 同拆）。

实现文件：`src/styles/host-desktop.css`、本 docs。（用户人工走查，本轮不跑自动化。）

---

## 0904 第 5 轮（feat/0904-new-base-r1）：输入框删除内容后占位文案恢复

预览评论 `div#messageInput.message-input.content-editable-input`（输入框）：「输入内容再删除后，占位文案消失了，不合理，希望不要消失」。

- 根因：占位符由 `.content-editable-input:empty::before { content: attr(data-placeholder) }` 驱动；contenteditable 输入删空后浏览器常残留 `<br>`/空 `<div>`，`:empty` 不再匹配 → 占位文案消失。
- 修改：`src/components/MessageInput.tsx` `handleInput` 检测到 `innerText` 已删空且子节点仅剩 `<br>`/空 `div` 时 `replaceChildren()` 清空，让占位符恢复显示（img/附件等实质内容不受影响）。
- 实现文件：`src/components/MessageInput.tsx`、本 docs。（用户人工走查，本轮不跑自动化。）

---

## 0904 第 6 轮（feat/0904-new-base-r1）：会话卡两行布局省略 + 状态右下角 + 项目筛选自绘省略/统一 Tooltip/定宽 160px

预览评论（会话状态页项目筛选与卡片区）：「参考设计稿布局对话卡片、省略规则遵循设计稿」「状态希望始终在卡片右下角」「筛选文案 14px、超出需省略、hover 展示全部」「悬停样式与其他地方不一致（应统一 Tooltip）」「筛选表单定宽 160px」。

- **卡片布局对齐 Figma Container 组件 13656:5280**：两行结构——行 1 标题独占（14/600/#1F2329，行高 26，可省略）；行 2 `meta-row` = 项目名 + 状态（均 12/400/#6C7076，行高 20，itemSpacing 8）。原实现把项目名放在标题行右侧，与组件不符 → `SessionBoard.tsx` 拆行。省略约束：`.session-card-title` `flex:1; min-width:0`；`.session-card-project` `flex:1 1 auto; min-width:0`（**评论 2026-09 追加：状态固定右下角**）；`.session-card-status` `flex-shrink:0`。
- **项目筛选（Figma Select Input：32 高 / r6 / 1px #DCDFE6）**：原生 select 无法做省略与自绘悬停 → 外层 `.session-board-filter`（**定宽 160px**）渲染三层：省略文字层 `.session-board-filter-text`（14px ellipsis）+ chevron-down 箭头 + 透明 `.session-board-filter-select` 覆盖（保留原生下拉）；文案 = 选中项目录名。
- **长项目 hover 用统一 Tooltip 组件**（与活动图标等一致，不用浏览器 title）：仅溢出时启用（`scrollWidth > clientWidth` 实测），气泡放宽 `max-width: 480px`（全局 250 会截断 55 字符长名）。测量注意：Tooltip `disabled` 翻转令 filter 换父重挂，ResizeObserver 监听旧节点回调会把状态误置回 false → 改为每次提交后重测（deps 含 `filterOverflow`）。
- 实现文件：`src/components/SessionBoard.tsx`、`src/styles/SessionBoard.css`、本 docs。（用户人工走查，本轮不跑自动化。）

---

## 0904 第 7 轮（feat/0904-new-base-r1）：侧栏会话行状态点右移 + 官方状态图标 + 分组 chevron（Figma 13656:5470「Sidebar - 任务导航」+ 13561:39969 icon 集）

设计稿链接两帧：`13656:5470`（Sidebar - 任务导航：会话行 12 个状态变体规格）+ `13561:39969`（用到的 icon 组件集）。用户确认三项口径后实施：范围 = 会话行 + 项目分组行；状态指示**整体迁到行右端 24 槽、hover 时被「⋯」覆盖**；绿点 = **新增功能「新完成未读标记」**（用户只负责样式，合码需开发实现契约，见下「开发合码注意」）。

- **状态位从标题左侧移到行右端 24 槽**：`.desktop-session-item` 内删左图标位（原 waiting 紫铃铛 codicon-bell / running 蓝 codicon-loading / idle 灰点），`.desktop-session-item-main` 只留标题（padding `0 32px 0 16px` 给右槽留位）。右槽三态（非 hover 显示，样式 `DesktopApp.css`）：
  - 等待确认 = 琥珀点 `#E6A23C`（8px，替换原紫铃铛，出现逻辑不变）
  - 运行中 = loading 转圈环（`13576:40802` 官方矢量：环身 `#D4D7DE` + 转弧头 `#565A60`，css 旋转动画；dark 下环身白 16%/弧 `#D4D7DE`）
  - 已完成未读 = 绿点 `#16A34A`（8px，新增 `session.newCompleted` 驱动）
  - **激活（current）或可见于其它 pane（--visible）的会话不渲染状态点**——对应「已完成打开后绿点消失」：打开即不再提示；hover/focus 时右槽淡出、「⋯」淡入（`.desktop-session-more-btn` 24×24、hover 自身黑 8% 圆角底 `13656:5328`）。
- **行/组头视觉对齐**：行高 32 保持、行距 2→4px、文字 13→14px/lh22 色 `#1F2329`；hover 底 `#EEF0F3`、选中与可见底 `#EBEDF0`（原 vscode token 泛蓝灰改固定 Figma 色）+ 选中标题 500；分组头 14/500 `#6C7076`（原 13px description 色），组头 codicon chevron 换成官方 `GroupChevron`（展开 `^` `13498:16662` / 收起 `>` `13561:39968`，16px `#565A60`）。
- **新契约字段**：`DesktopSessionEntry.newCompleted?: boolean`（webview 与 webview-fixtures 双 types），mock desktop-full 给「重构 user 模块错误处理」置 true 供 8899 走查绿点。
- 实现文件：`src/components/DesktopSidebar.tsx`、`src/styles/DesktopApp.css`、`src/types/index.ts`、`packages/webview-fixtures/src/types.ts`、本 docs。（用户人工走查，本轮不跑自动化。）

### 开发合码注意（用户委托提醒）

1. **绿点 = 新功能**：桌面 host 需在 `refreshSessionTree()`（desktopHost.ts:2497）为每会话下发 `newCompleted`：
   - 置 true：agent 一轮 turn 结束（`isStreaming` false 且无 `pendingConfirmations`）时，该会话**不在任何 pane 显示**（后台跑完）→ 记「有未读新完成」；
   - 清 false：会话被打开/聚焦到任一 pane（或该会话开始新一轮 / 被删除）时清除；随后 `refreshSessionTree()` 推送。
   - 优先级仅供 UI 参考：waiting > running > newCompleted（同会话同时多态时只显高优先）。UI 层另加 `!isCurrent && !isVisible` 过滤，host 若已按「打开即清」实现，该过滤仅作双保险。
2. **DOM/class 变更影响既有测试断言，需同步**：`.desktop-session-status-icon.codicon-loading` / `.codicon-bell` / `.desktop-session-dot` 已从会话行移除（改行右端 `.desktop-session-status-slot--running/waiting/completed` 槽内 svg）；断言涉及处：`webview/tests/webview/desktopApp.test.tsx:1112-1172`、`webview/e2e/desktop-app.e2e.ts:176`。等待确认语义（无挂起即消失）未变。

---

## 0907 第 1 轮（feat/0907-new-base-r1）：桌面语义 token 层 + 深色变量规范化第一批

取值权威：codechat-desktop-skill 分支 `feat/approved-dark-theme-contract` 的 `tokens/desktop-dark-mapping.json`（18 个 user-approved 核心 + derived 扩展，用户 2026-09-06 批准方向）；light = wave 现状值快照（个别 ≠ codechat 官方 token 值，勿反写 skill）。

### A. host-desktop.css 顶部语义 token 层（第一批核心面/文字/按钮变量化）

- **light 块**（`:root[data-host="desktop"][data-theme="light"]`，现值快照）：定义 `--cc-bg-conversation #ffffff`、`--cc-bg-navigation #f7f8fb`、`--cc-bg-inspector/overlay #ffffff`、`--cc-bg-code #f7f8fa`、文字梯度、`--cc-action-primary #1f2329(+hover #34383f/text #fff)`、`--cc-border #dcdfe6` 等；桥接 `--vscode-button*`/`chat-requestBubble*`/`panel-background`/`sideBar-background`/`textCodeBlock`/`terminal-background`/`input-border`（浅色零回归）。
- **dark 块**（`:root[data-host="desktop"][data-theme="dark"]`，approved 值）：conversation `#111314`、navigation/inspector `#181a1b`、overlay `#232526`、code `#1b1d1e`、文字五档 `#e5e7e8/#c4c7c9/#a0a5a8/#858b8f/#62686b`、fill `#25292b`、hover/pressed `#303436/#393e41`、**主按钮浅灰底深字 `#e0e3e5 + #191c1e`**（dark 反转浅色炭黑钮）、border `#414649`、border-focus `#a0a5a8`；新增桥接 `editor-background→inspector`、`button-foreground→action-primary-text`、`foreground/input-foreground→text-primary`、`list-activeSelection*→fill-pressed`、`focusBorder→border-focus`（全部去蓝）。取值与 mapping 逐字一致（26 个 dark `--cc-*` 中 25 个 ✓）。
- 全部变量与覆盖规则均带 `[data-host="desktop"]` 门控，仅桌面端生效；VS Code 插件 / JetBrains 端 data-host 恒为 `ide`（index.tsx:14-15），不受影响。

### B. 组件级接线（host-desktop.css，未改组件 css）

- **字形色误用修补**：`.header-button.active` / `.todo-in_progress .todo-status-icon` / `.plugin-tab.active` 把 `--vscode-button-background` 当字形色 → 改 `color: var(--vscode-foreground)`（dark 主按钮反转为浅灰后原「深色文字」不可读）。
- **composer 深色**：`.input-content` = 同画布 `--cc-bg-conversation #111314` + 强边框 `--cc-border #414649`（用户 0904 拍板），focus-within 边框 `#a0a5a8` + 12px 黑影。
- **浮层/焦点中性化**：6 处浮层背景旧 `#27292b` → `var(--cc-bg-overlay)`；confirmation-command/mcp-params 用 `var(--cc-bg-code)`；dark 链接统一走既有 `#4daafc`（裁决：CC 深色链接权威，skill mapping 现派生 `#8bbcf0` 属误派生，待走查后回写 skill）。
- **task/queued 面板卡 bg-panel 面**（用户走查评论「这里面板的颜色重新计算」）：`.task-list-inline` / `.queued-message-list-container` base 底色 `--vscode-menu-background`（dark #1f1f1f 未入语义层）→ 覆盖为 `--cc-bg-panel`（light #fff / dark **#181a1b**，对齐 codechat `composer-task-list` 面）+ 强边框 `var(--cc-border)`（dark #414649）；`.queued-items-scrim` 渐隐终点色随卡面。

实现文件：`src/styles/host-desktop.css`、本 docs。（用户人工走查，本批不跑自动化。）

## 0908 第 2 轮（feat/0908-new-base-r1）：设置页「新增」按钮图标换官方添加 SVG + 随文字反白

预览走查评论（8899，钩子 tab `button.settings-save-btn`「新增钩子」）「添加按钮没有反白」，附 Figma 链接 `13757:2273`（Component 12 组件集 13383:4080「类型=添加」）。范围：设置页 4 个同形态「新增/新建」主按钮统一修复。

- **问题**：这些主按钮内「+」用的是 `codicon codicon-add` 字体，字形色固定灰（light `#606060`、dark `#ccc`），不随按钮文字反白 → 浅色炭黑主按钮上图标灰暗、深色浅灰主按钮上图标近乎隐没（vision 复核两主题均为文字清晰而图标失配）。
- **修复**：
  - `HeaderIcons.tsx` 新增 `SettingsAddIcon`（Figma 13757:2273 官方 SVG：fill `currentColor`，随按钮前景反白——浅色钮内白、深色钮内 `#191c1e`；原画布 16×16，导出 scale=2 为 32 网格 path，viewBox 保持 32 配 16×16 渲染）；
  - 四个设置视图把 `<i className="codicon codicon-add">` 换 `<SettingsAddIcon />`：`SettingsHooksView.tsx`（新增钩子）、`SettingsSkillsView.tsx`（新建技能/新增指令）、`SettingsSubagentsView.tsx`（新增子代理/新增指令）、`SettingsMcpView.tsx`（新增…MCP 服务）。
- **开发合码注意**：设置页外还有两处 codicon-add（`DiffPane.tsx:233`「添加到输入框」、`DesktopHostSelector.tsx:185`「添加主机…」）不在本轮范围，若需对齐 Component 12 图标可后续单独处理。既有测试按按钮可读名（`getByRole("button", { name: /新增钩子/ })` 等）查询，不受图标替换影响。
- 实现文件：`src/components/HeaderIcons.tsx`、`src/components/SettingsHooksView.tsx`、`src/components/SettingsSkillsView.tsx`、`src/components/SettingsSubagentsView.tsx`、`src/components/SettingsMcpView.tsx`、本 docs。（用户人工走查后确认推送，type-check 通过。）

## 0908 第 3 轮（feat/0908-new-base-r1）：桌面侧栏对话/设置选项几何统一（30px / 项距 2 / 分类 12 / 圆角 8）

预览走查评论（8899，`li.desktop-session-item--current` 会话行 + 两条跟进）「对话、设置的选项，统一调整，高度30px，统一分类下间距2px，分类之间间距12px，圆角8px」；随后跟进「这个返回和新对话也是30px 8px」「账户卡热区这里也是」「account-card-collapse-btn 也改成30x30 8px」。

- **统一规格**：侧栏会话行与设置导航项 = 选项高 30px、同分类内项距 2px、分类间距 12px、圆角 8px。
- **实现文件与值**：
  - `DesktopApp.css`：`.desktop-session-items` gap 4→2；`.desktop-session-item` min-height 32→30、r6→8；`.desktop-sidebar-new-chat` height 32→30（r8 已是）；`.desktop-session-group-header` height 32→30、r6→8（8899 后续评论「这里应该也是30px」补：分组头并入统一规格）。
  - `host-desktop.css`：会话分组间距 margin-top 4→12；新增 desktop 覆盖 `.settings-nav-item` 30/r8、`.settings-nav-items` gap 2、`.settings-back` 30/r8（base 32/r6/gap4 供非 desktop 场景不回归）；`.account-card-hotzone` desktop padding 上下 4→3（行高 32→30）；`.account-card-collapse-btn` 32×32/r6 → 30×30/r8。
  - `AccountCard.css`：`.account-card-hotzone` base padding 上下 4→3 + r6→8（desktop 专用组件，IDE 无此栏）。
- 既有 hover/选中底色规则不变，仅几何。实现文件：`src/styles/DesktopApp.css`、`src/styles/host-desktop.css`、`src/styles/AccountCard.css`、本 docs。（用户 8899 走查后确认推送；headless 实测：会话项 30/r8/gap2、设置项 30/r8/gap2/组距 12、新对话/返回/账户热区/收起按钮均 30/r8。）

## 0908 第 4 轮（feat/0908-new-base-r1）：单行下拉菜单选项高度统一 28px

预览走查评论（8899，`li.permission-mode-item.mode-default.selected`「修改前询问」· `ul > li:nth-of-type(1)`）「所有单行的下拉菜单选项高度28px」。

- **范围确认（AskUserQuestion）**：permission-mode（权限模式）、plus（+添加）、more（⋯账户）、panel-toggle（面板切换）、desktop-session-menu（会话行⋯）、desktop-workdir-menu-item（本地主机选择等单行项）= 单行选项统一 28px；**workdir「最近打开」两行带父路径注释项先不改**。
- **修复**（均 `host-desktop.css`，`[data-host="desktop"]` 限定，原统一 min-height 32px）：
  - `.permission-mode-item`、`.plus-menu-item`、`.more-menu-item`、`.panel-toggle-menu-item`、`.desktop-session-menu-item`、`.desktop-workdir-menu-item` min-height 32→28px。
  - workdir 两行项单独排除：`.desktop-workdir-menu-item:has(.desktop-workdir-menu-parent)` 保留 min-height 32px（两行注释行不压缩）。
- 实现文件：`src/styles/host-desktop.css`、本 docs。（用户人工走查，type-check 前已确认；等待用户确认后推送。）

## 0908 第 4 轮补充（feat/0908-new-base-r1）：workdir 菜单分组标签对齐加粗 + 最近打开两行项高度重算

预览走查评论（8899）：① `div.desktop-workdir-menu-label`「最近打开」「和下方选项的图标没有对齐，也没有加粗，参考系统指令的下拉菜单」；② `div.desktop-workdir-menu-item` 首条「CC02/…」「选项高度再计算下，现在上边距大于下边距，感觉没有对齐」。

- **① 分组标签**（`.desktop-workdir-menu-label`，最近打开 / SSH 主机共用，host-desktop.css 新增 desktop 覆盖）：padding-left 12→**8px**（label 文字左缘与选项图标同列，headless 实测 579.06 vs icon 579.1 对齐）；font-size 11→**12px**、font-weight 500、去 opacity 0.6，参照 `/` 系统指令弹层分组标题（12px/500）；浅色 `#6C7076` / 深色 `#9A9EA5`。原因：0908 第 4 轮把菜单 item 桌面化时 label 漏了桌面覆盖，仍用 base 12px 左距 + 淡化小字。
- **② 最近打开两行项**（`.desktop-workdir-menu-item:has(.desktop-workdir-menu-parent)`）：原 min-height 32 + 上下 0 padding 把两行文字块（30px）压得上下仅 1px 贴边；改为 **min-height 0（内容高驱动）+ 上下对称 3px padding** + 显式行高 name `17px`（14px 字）/ parent `13px`（11px 字）→ 条目高 36px，文字块上下留白对称，图标/两行文字块/移除钮垂直共心（实测 item 36、path 顶距 3/底距 3、icon 与文字块中心同为 417）。
- 实现文件：`src/styles/host-desktop.css`、本 docs。（headless 几何实测，等用户 8899 走查确认后推送。）

## 0908 终端「重启终端」恢复按钮样式规范修复（feat/0908-new-base-r1）

预览走查评论（8899，`button.preview-pane-button`「重启终端」· terminal exited 空态）「检查按钮样式是否符合规范」。

- **问题**：该按钮复用通用 `.preview-pane-button`（24×24 图标钮规范），带文字时文字溢出 24px 小方框；且 host 的 icon-button 通用色规则（light `#565A60` / dark `#9A9EA5`、hover `#EEF0F3` / 8% 白）会压过 base 恢复按钮的 `--vscode-button-foreground` / hover → dark 下浅灰底配灰字不可读。
- **修复**（DesktopApp.css + host-desktop.css）：
  - `DesktopApp.css`：`.preview-pane-error` 与 `.terminal-pane-exited` 下的 `.preview-pane-button` 合并为文本恢复按钮（width auto、padding `4px 12px`、nowrap、`--vscode-button-background` 实底 + foreground + hoverBackground）。
  - `host-desktop.css`：在上述通用 icon-button 色规则后补高特异覆盖（`.preview-pane-error / .terminal-pane-exited` 两容器限定）——light 文字 `--vscode-button-foreground`、dark 同，hover 保持 `--vscode-button-hoverBackground` 实底加深，不被通用 hover 漂回浅灰。
- 验证（headless 注入同构 DOM 实测）：light bg `#1F2329` / 字白、dark bg `#E0E3E5` / 字 `#191C1E`（桌面语义主按钮，随 --vscode-button\* 桥接）；宽度 78px 自适应内容。
- 实现文件：`src/styles/DesktopApp.css`、`src/styles/host-desktop.css`、本 docs。（等用户 8899 走查确认后推送。）

## 0908 面板文本恢复按钮 audit（feat/0908-new-base-r1）：ChatApp remote forward「重试」并入

预览走查评论「检查相似页面是否还有类似按钮需要调整，包括深色模式」的 audit 结论与补修。

- **audit**：枚举全部使用 `.preview-pane-button` 的 6 组件（DesktopPanelTabs / PreviewPane / DiffPane / FilePane / TerminalPane / ChatApp），仅 3 处为文本恢复按钮（其余均为 24×24 图标钮，无此问题）：PreviewPane `.preview-pane-error`「重新加载」、TerminalPane `.terminal-pane-exited`「重启终端」、ChatApp `.preview-pane-forward-error`「远程预览加载失败 · 重试」（ChatApp.tsx:2860）。前两处已修复，第三处此前遗漏。
- **修复**：`.preview-pane-forward-error .preview-pane-button` 加入 DesktopApp.css base 文本恢复按钮合并选择器组 + host-desktop.css light/dark 高特异覆盖组（结构与 `.preview-pane-error` 同为全幅 overlay + 描述 + 重试主按钮）。
- 实现文件：`src/styles/DesktopApp.css`、`src/styles/host-desktop.css`、本 docs。（等用户 8899 走查确认后推送。）

## 0909 第 2 轮（feat/0909-new-base-r1）：workdir 菜单无「最近打开」记录时不渲染分隔线

预览走查评论（8899，`div.desktop-workdir-menu-separator`·`div > div:nth-of-type(1)`）「在还未选择工作目录的时候，不显示这条分割线」。

- **根因**：菜单无条件在「最近打开」列表与「浏览…」之间渲染 separator；recents 为空（从未选过目录 / 最近列表已清空）时菜单只剩 `[分隔线, 浏览…]`，分隔线悬在顶部、无分组意义。
- **修复**（DesktopWorkdirSelector.tsx）：separator 与「最近打开」label 同条件渲染——`recents.length > 0` 才输出；有最近记录时照常分隔两组。
- 实现文件：`src/components/DesktopWorkdirSelector.tsx`、本 docs。（type-check 通过，用户 8899 人工走查后确认推送。）

## 0909 第 3 轮（feat/0909-new-base-r1）：账户卡「登 录」品牌红按钮文字反白

预览走查评论（8899，`button.account-card-login`「登 录」）「登录文案需要反白」。

- **根因**：按钮为品牌红实心底、白字（原型 sidebar-login-button 同款）；base 文字走 `color: var(--vscode-button-foreground, white)`——桌面语义层 dark 档把该 token 桥接成主按钮「浅灰底深字」的 `#191C1E`（host-desktop.css `--vscode-button-foreground: var(--cc-action-primary-text)`，0907 语义层），登录按钮品牌红底上渲染成深字、失反白。
- **修复**（AccountCard.css，桌面专用组件文件）：登录钮文字恒白 `color: #ffffff`，不再引用随主按钮语义变化的 `--vscode-button-foreground`（注释说明原因）；hover 仅加深背景、字色不变。落点避开 host-desktop.css（其上另有并行会话 toast 在途改动）。
- 实现文件：`src/styles/AccountCard.css`、本 docs。（type-check 通过，用户 8899 人工走查后确认推送。）

## 0909 第 4 轮（feat/0909-new-base-r1）：设置页保存 toast 参考 codex 形制（顶部居中、语义三色、右界面锚定、落下动效）

用户走查（8899 设置页保存）：① toast 参考 codex 样式——顶部居中、soft 彩底 + 同色文字、描边圆勾图标 + 关闭钮，颜色绑语义变量不写死；② 动效「应在右侧界面居中展示，从上到下出现」；③ 深浅模式关闭钮与语义图标同色（勿淡显）。

- **类型与消息**：
  - `UpdateToast` 增加 `type?: ToastKind`（`"success" | "info" | "error"`，缺省视为 info）；`packages/webview/src/types/index.ts` 与 `webview-fixtures/src/types.ts` 平行副本同步（desktopHost 消费 fixtures dist，改后重 build）。
  - `desktopHost.ts`：设置保存/失败与 AGENTS.md 保存/失败 4 处 `showToast` 按语义标注 `type`（保存成功 `success`、失败 `error`）——base 无 type 的 toast 仍按 info 渲染，不回归。
- **语义色 token**（host-desktop.css `:root[data-host="desktop"]` light/dark）：skill tokens.css 契约「color-_ fg + color-_-soft bg + icon/text 并存」。light：success `#16a34a`/`#f0fdf4`、danger `#dc2626`/`#fef2f2`、info `#2563eb`/`#eff6ff`；dark（feat/approved-dark-theme-contract `build_desktop_dark.py` 值）：success `#83d6a0`/`#192b21`、danger `#f19b95`/`#332021`、info `#8bbcf0`/`#1b2939`。
- **渲染**（ToastStack.tsx）：`ToastGlyph` 内嵌 16px 描边圆图标（success 勾 / error 叉 / info i），替换原文字 emoji 图标；`toast.loading` 仍渲染 spinner；toast 根加 `toast--<type>` class 驱动语义色。
- **定位**：`.toast-stack` 桌面化为 `position: fixed; top: 12px` 顶部居中栈；ChatApp 传 `anchorSelector`——设置页打开锚 `.settings-page .settings-content`（避开 240px 左导航），普通桌面锚 `.desktop-pane-rows`（工作区中心、避开会话侧栏）。ToastStack 用 ResizeObserver + window.resize 测锚列中心，以内联 `left` 覆盖整栈水平位 → 始终落在用户操作的「右侧界面」中心。
- **动效**：`toast-drop-in` 自顶向下 `translateY(-12px → 0)` + 淡入 0.18s；多条时 `column-reverse` 新通知从顶部滑入。
- **关闭钮**：`.toast-close` `color: inherit` + `opacity: 1`，与语义图标同色同浓度（light/dark 各补一条同 specificity 规则，盖过 0908 轮全局图标统一色 `#565a60`/`#9a9ea5`）；hover 仅加深背景（`color-mix(currentColor 14%)`），颜色不变。
- 实现文件：`desktopHost.ts`、`webview-fixtures/src/types.ts`、`webview/src/types/index.ts`、`ToastStack.tsx`、`ChatApp.tsx`、`host-desktop.css`、本 docs。（fixtures 重 build 通过；用户 8899 人工走查三种语义样式后确认推送。）

## 0909 第 5 轮（feat/0909-new-base-r1）：任务列表卡上下内边距对称 8px

预览走查评论（8899，`div.task-list-inline`「任务列表 (4)已完成 3进行中 1待执行 0」）「检查任务列表的上下内边距是否一致，现在感觉下面高了点，可以收拢一下」。

- **现状**：`.task-list-inline` base `padding: 8px 12px 12px`——上 8 / 下 12，底部多 4px（桌面覆盖层未覆盖 padding，沿用 base 值）。
- **修复**（TaskList.css，共享 base 文件）：`padding: 8px 12px 8px` 上下对称。落点说明：host-desktop.css 彼时含并行 toast 会话在途改动，desktop 覆盖放同文件会把他人内容带入本 commit → 改共享 base（TaskList 三端同结构，对称内边距对 IDE 端同样成立）；commit 暂不带 docs（docs 尾含 toast 会话未推的第 4 轮段，避免夹带），toast 推完（`28838ff6`）后再补本段。
- 实现文件：`src/styles/TaskList.css`、本 docs（后补段）。（commit `2187d55f` 已推；type-check 通过，用户 8899 人工走查后确认推送。）

## 0909 第 6 轮（feat/0909-new-base-r1）：设计师返工——toast 按 `position` 分两栈 + 语义色收窄 + TaskList 回落共享 base

按设计师 ailsa 对 PR #2147 的 ①②③ 答复返工（第 4、5 轮改动被部分修正）。

- **① toast 分两栈**（此前第 4 轮把整个桌面 `.toast-stack` 全量顶部居中，误伤后台会话确认 toast）：
  - 类型 `ToastPosition = "top" | "bottomRight"`，`UpdateToast.position?` 由宿主**显式声明**（不以「是否带按钮」推断）；`webview/src/types/index.ts` 与 `webview-fixtures/src/types.ts` 平行副本同步。
  - `ToastStack.tsx` 拆两个互不干扰的栈：`toast-stack--top`（`position` 缺省 `"top"`，应用级全局提示，顶部居中新形态 + 锚定内容列 + 落下动效 + 语义图标）与 `toast-stack--bottomRight`（`position: "bottomRight"`，后台会话确认 toast，沿用既有右下角通知形态：深底浅字、自底向上滑入、无语义图标）；两栈可同屏共存。
  - `host-desktop.ts`（desktopHost）只在后台会话确认 toast 上标 `position: "bottomRight"`，其余 `showToast` 调用一律缺省。
  - **移除「已完成」toast**（2026-09-10 拍板）：后台会话正常完成只置 `newCompletedAgents`（侧边栏「已完成未读」绿点），不再发 toast——绿点是「已完成」的唯一提醒通道；保留 `confirmationToastAgents`、「待确认」toast（`position: "bottomRight"`）、`focusSessionFromToast`、`replayPendingConfirmations`、`handleToastAction` 的 focusSession 分支、`focusSession` ToastAction。
- **② 语义三色收窄**：`ToastKind` 保持 `"success" | "info" | "error"` 三值（info 恢复）；`type` 只标**设置页结果型**提示（保存成功/失败、删除/移除技能·子代理·钩子·MCP 成功/失败、MCP 连接/断开失败），共 14 处；**未标 `type` 的应用级提示一律中性**（默认浮层底色 + `--vscode-widget-border` 描边 + `--vscode-foreground` 文字、不渲染语义图标），不再缺省回退为 info 蓝。
- **③ TaskList padding 回落共享 base**：`.task-list-inline` base 回到 `padding: 8px 12px 12px`（撤销第 5 轮的 base 改动，IDE 两端保持原值）；桌面收拢改放桌面覆盖层 `[data-host="desktop"] .task-list-inline { padding: 8px 12px 8px; }`。
- **顺手清掉死 action 变体**：删除「打开下载页」这一已死的 ToastAction 变体（两处类型副本 + `handleToastAction` 的 if 分支 + 相关测试用例）——该链路已随 updateChecker 删除，动作只剩 `focusSession` 一种。
- **spec 同步**：`desktop-account-and-settings.md`（撤销「webview 右下角」措辞 + 新增「toast 形态与路由」一条，按 `position` 表述、不写 hex）；`desktop-shell.md`（撤销「模仿 VS Code」措辞，指向上条路由规则）；`desktop-sessions.md`（故事更名「后台会话活动通知」→「后台会话确认提醒」、删已完成 toast 相关内容与 4 个旧场景、铃铛 4 处改「琥珀色状态点」、绿点边界写明为「已完成」唯一通道、toast 关系边界改为只讲确认 toast 并记录其保留右下角形态）。
- 实现文件：`desktopHost.ts`、`webview-fixtures/src/types.ts`、`webview/src/types/index.ts`、`ToastStack.tsx`、`ChatApp.tsx`、`TaskList.css`、`ToastStack.css`、`host-desktop.css`、`desktopHost.test.ts`、`toastStack.test.tsx`、`chatAppToast.test.tsx`、`desktopApp.test.tsx`、三份 spec、本 docs。

## 对话流排版契约第 1 项（conversation-typography TXT-01）：阅读正文改用 UI 字体（F-01）

> **规则已归档**：本节及以下至「表格对齐（F-17）」各节定下的规则，已整理为规格 `docs/specs/desktop/desktop-conversation-typography.md`（权威来源）；台账继续保留走查过程、前后实测与截图。

依据来源：codechat-desktop-skill 的 `references/conversation-typography.md`（提交 b7058b0）渲染不变量 **TXT-01**「阅读正文使用 UI 字体角色，不继承 editor-font-family；代码字段显式绑定等宽角色」；`references/conversation-audit.md` 第 33 行定位线索（浏览器中 Markdown 正文 computed 栈为 Menlo/Monaco/Courier New，需追踪 `.message-content` 祖先）。走查清单见工作目录外 `conversation-style-audit.html`（F-01，分组 G1）。

- **问题（修复前 headless 实测）**：base `Message.css:233 .message-content{font-family:var(--vscode-editor-font-family)}` 使对话流阅读正文全部渲染为 `Menlo, Monaco, "Courier New", monospace` —— `.markdown-content` 下 p / li / blockquote / h1–h6 / table th / td、以及错误块 `.message.assistant .error`（其自身只声明 color/italic/padding/max-height/pre-wrap，字体是继承来的）。同页 reasoning / 用户气泡 / 工具行 / ask-user 答案框本就是 UI 栈 `-apple-system, "system-ui", sans-serif`，即同一产品内两种字体角色并存。
- **修复**（host-desktop.css，markdown 圆角段之后新增，仅 1 处声明）：
  ```css
  [data-host="desktop"] .message-content {
    font-family: var(--vscode-font-family);
  }
  ```
  `--vscode-font-family` 即 body 的 UI 栈，与 reasoning/工具行等既有 UI 角色一致；**不覆盖 base**（IDE 宿主行为不变）。代码字段（Markdown code/pre、bash 命令与输出、写入预览与路径、lsp-output、diff、mermaid）各自规则内已显式绑定等宽栈，故此处不重复声明，避免在文件末尾堆叠覆盖（符合契约「对冲突规则做收敛」的实现边界）。
- **验证方法（等宽判别，避免中文回退导致的肉眼误判）**：在同一元素内临时注入 `iiiii` 与 `WWWWW` 两个隐藏 span 量宽——等宽字体宽度相等（比值 1.0），比例字体比值 ≈0.25。`:has()` 判据不参与。
  - 修复前（base 等价态）：md-p / md-h1 / md-li / md-blockquote / md-td / error-block 全部 `monoRatio=1.0`（Menlo）。
  - 修复后：上述六类全部 `monoRatio=0.25`（UI 栈）；`code`、`pre`、`pre code`、`td code`、`.bash-command`、`.bash-command-output`、`.write-preview-content`、`.lsp-output`、diff 词级 span 全部仍 `1.0`（等宽保持）。
  - 规模：对话流内文本节点 UI 栈 123→365、Menlo 栈 1134→892（差额 242 即本次转正文字体者）。
  - 几何无回归：p 760×42 / 2 行、blockquote 6 行、error 17 行、h1 760×32.8 / 1 行，前后一致；字宽差异 <1%（td 395.7→389，无换行数变化）。
  - 浅深同值（TXT-08）：light/dark 两组测量结果一致。
  - IDE 宿主回归：以 `data-host="vscode"` 代理验证，全部元素回到 base 行为（正文 Menlo、13px 档），桌面覆盖未泄漏。
- **测试**：`pnpm -F wave-webview run type-check` 通过（exit 0）；仓库内无 `font-family` 样式断言（test/e2e 零引用），故结论以浏览器 computed 值为准（CSS 改动，无逻辑测试覆盖点）。
- **口径说明**：错误块 `.message.assistant .error` 随本次一并转为 UI 字体——其等宽并非显式代码角色绑定而是继承副作用，且同类 `.tool-error` 本来就是 UI 字体，统一后两个错误面口径一致；真正的原始堆栈仍由 `pre`/`code`/日志区以代码角色承载。`font-style: italic` 属另一条（F-12），本次未改。
- **未覆盖项**：200% 缩放与 WCAG 1.4.12 文字间距覆盖；994×949 窄窗口与分屏实际内容宽度；流式未闭合代码围栏/表格；IDE 宿主真机（仅 data-host 代理解析）。
- 实现文件：`src/styles/host-desktop.css`、本 docs。（headless A/B 实测 + 同页前后截图，等用户 8899 走查确认后推送。）

## 对话流排版契约第 2 批（TXT-02 / TXT-05 / TXT-06 + 角色表）：字号与行高绑定命名角色、宽表本地滚动（F-02 / F-03 / F-04 / F-05 / F-06）

依据来源：codechat-desktop-skill（b7058b0）`references/conversation-typography.md` 的渲染不变量 TXT-02（禁止按嵌套深度连乘 0.9em）、TXT-05（正文行高一致）、TXT-06（长词/路径/链接折行、宽表本地滚动、画布不产生横向滚动）与角色表（表格单元格 = 正文 14/22、行内代码与代码块 = 13px、表头不低于正文）；`references/conversation-audit.md` 对应条目。走查清单见工作目录外 `conversation-style-audit.html`（F-02/F-03/F-04 属 G3·G4，F-05 属 G2，F-06 属 G8）。

**应用提交：`1e2ef0aa`**（`packages/webview/src/styles/host-desktop.css` + `packages/webview/src/components/Message.tsx`；base `Message.css` 与 IDE 宿主路径零改动）。

### 逐项修复与前后实测（1440px，light；dark 同值）

| 项   | 规则/角色 | 修复前                                                                                                                                                         | 修复后                                                                                                                            | 说明                                                                                                                                                             |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-02 | TXT-02    | td 12.6px / 17.64px；td 内 code **11.34px / 15.876px**（table 0.9em × code 0.9em 连乘）                                                                        | td **14px / 22px**；td 内 code **13px / 22px**                                                                                    | 去掉表格 0.9em 与行内 code 的 em 链，按角色绑绝对值；11.34px 节点 21 → 0                                                                                         |
| F-03 | 角色表    | th 12.6px / 17.64px（w600）                                                                                                                                    | th **14px / 22px**（w600）                                                                                                        | 「不低于正文」为执行档；最终字重/字号待候选 C-03 视觉拍板（本轮未改）                                                                                            |
| F-04 | 角色表    | 行内 code 12.6px / 18.9px；pre 12.6px / 17.64px；pre code 同                                                                                                   | 行内 code **13px**；pre **13px**；pre code **13px**（本轮仅字号；行高于同日按用户指示追加为 20px，见文末「代码角色行高 20px」节） | 原为「行高随 C-02 候选未动」；**2026-09-10 用户指示三类载体取 20px 并已实施**，C-02 剩余范围 = bash / 写入预览 / lsp-output                                      |
| F-05 | TXT-05    | p 14/**21**；li 14/**19.6**；blockquote 14/**19.6**；用户气泡 14/**19.6**（22px 写在 `.user-text-block` 上被内层 1.4 顶掉）；错误块 14/19.6                    | 全部 **14 / 22px**                                                                                                                | 统一整数行盒 22px，命中内层 `.user-text-block .message-content.user-content`；p 外边距 8px、li 4px 不变；错误块随其所属正文角色                                  |
| F-06 | TXT-06    | 最宽表 882px 落在 760px 列内，父级 `overflow-x: visible`，容器 `scrollWidth 912 / clientWidth 800`（**被 `.messages-container{overflow-x:hidden}` 静默裁切**） | 包 `.md-table-scroll`（`overflow-x:auto`），容器 `800 / 800`；表 973px，`maxScrollLeft 213`，滚到最右时末列完整可见               | 包装层在 `Message.tsx` 的 `renderer.table` 生成；**需 DOMPurify `ALLOWED_TAGS` 放行 `div`**，否则 sanitize 会剥掉包裹层只留子节点（首轮实测 wrapper 缺失即此因） |

对照项（不应变化，实测未变）：`.bash-command` 13px/15.6px、`.compact-params` 12px/18px、h2 21px/27.3px、行内 code/pre 之外的工具行；最小字号仍是 10px（`span.tool-status-dot`，与本次无关）。

### 换行 / 裁切 / 布局位移

- **正文换行零变化**：行盒数（Range.getClientRects 去重行顶）逐元素 p 2→2、li 1→1、quote 3→3、用户气泡 7→7、错误块 7→7、pre 1→1；全页合计 p 98→98、li 97→97、quote 30→30。正文 font-size 未变（14px），行盒增长全部来自行高 19.6/21 → 22px（即契约要求的统一，属预期位移：p 760×42→760×44、li 704×20→704×22、用户气泡 780×153→780×170、错误块 780×128→780×142）。
- **表格**：font-size 12.6→14px 是角色表要求，必然使单元格文本变宽 —— 128 个单元格中折行数 12 → 40（最多仍 4 行），表格高度随之上浮（8 列样例 300 → 616px）。**无裁切**：所有单元格 `scrollWidth == clientWidth`（over 0），`white-space: normal` + `overflow-wrap: break-word` 使长路径在格内折行；超出列宽的表格转为本地横向滚动。
- **画布无横向滚动**（TXT-06 验收）：1440 / 994 / 900 / 400px 四档均 `documentElement.scrollWidth == clientWidth`（1440=1440、994=994、900=900、400=400），`.messages-container` 的 `scrollWidth == clientWidth`（修复前 994/900/400 档为 912 vs 733/639/360）。
- **400px 视口验收**：包裹层 `clientWidth 320 / scrollWidth 973`，可滚到底（`maxScrollLeft` > 0），滚到最右时末列可见 → 「表格可横向滚动看到全部列」达成。

### IDE 宿主回归与验证方法

- 修复方式仍为桌面宿主限定：新增规则全部带 `[data-host="desktop"]` 前缀，base `Message.css` 未改。`Message.tsx` 的包裹层是结构变化，IDE 宿主无对应样式 → 以 `data-host="vscode"` 代理 A/B（同一张表：保留包裹层 vs 临时拆掉包裹层）实测 `table` 几何完全一致（748×68 / top 1860），包裹层 computed `overflow-x: visible`、`margin: 0`、`max-width: none`，画布无横向溢出。
- 测量口径：「修复前」为**同页等效回退态**（注入样式中和本批 desktop 覆盖，回到 base `Message.css` 取值），与 `/tmp/g234-before.json` 的真实基线一致，避免切换分支/改工作树的干扰；headless Chromium 1440×24000 绕过虚拟列表全渲染；浅深只通过工具条按钮切换（`button[title="切换深色/浅色主题"]`）。
- **测试**：`pnpm -F wave-webview run type-check` exit 0（全仓 pre-commit `pnpm -r type-check` 亦通过，含 vscode/desktop 包）；仓库内无对应样式断言，结论以浏览器 computed 值为准。
- 截图：`/Users/ailsa/Documents/07-AI/走查/截图/`（26 张，命名 `G2/G3/G4/F-05/F-06-…_修复前|修复后_light|dark.png`，含 400px 宽表滚动两态）。

### 本轮未覆盖 / 待你拍板

1. **F-07（表头配色与斑马纹 opacity）与 C-03（表头最终字重/字号）未做** —— 同属 G3，本轮只按执行档取「不低于正文」14/22·600，等视觉候选拍板。
2. **C-02（代码行高整数化）已收口** —— 行内 code / pre / pre code（F-04 指示）+ 用户同日追加「C-02 一起做」授权的 bash 命令与输出、写入预览、diff、lsp 输出全部取 20px（见文末「代码角色行高 20px」节）；diff 与 lsp 输出的**字号**也已按用户追加指示对齐到 13px（C-02 续）。
3. ~~表格单元格折行数 12 → 40（字号从 12.6 → 14 的直接后果），建议在 8899 走查时确认是否接受~~ → **口径已澄清：12 → 40 指「折行单元格数」**（内容折成 >1 行的 `td/th` 个数，分母为 5 张表的 128 个单元格），三态为 S1 12 → S2 40 → 当前 S3 33；用户已明确「表格保持 14px、不通过缩小字号解决折行」，**该项记为「字号修复已完成，表格阅读效果待验收」（V-01）**，详见文末「表格阅读效果待验收」节。
4. 未覆盖场景：流式输出中未闭合的表格/代码围栏；表格内嵌 mermaid 或超长无空格 token 的极端列；编辑器 200% 缩放与 1.4.12 文字间距；IDE 宿主真机（仅 data-host 代理）；窄窗口 + 分屏组合下的实际内容宽度；截图对比中的「修复前」为等效回退态而非真实历史构建。

## 对话流链接角色（用户规则 2026-09-10）：描述性链接 = 正文 UI / 直显地址 = 代码 13px（F-16）

规则来源：**用户 2026-09-10 本窗口口述**（skill 契约 conversation-typography.md 目前无链接角色条款，已作为回写候选 W-04 记录在走查清单）：

1. 描述性链接（如「查看预览」「参考文档」）使用 UI 正文字体，与所在正文保持一致；
2. 直接展示地址的链接（如 `http://localhost:8899/`、完整 HTTPS 地址）使用等宽字体，字号沿用当前代码角色 13px；保留长地址换行，不撑破消息区域；
3. 文件路径或代码中的链接继续使用等宽字体。

**应用提交：`d8a09697`**（`src/components/Message.tsx` + `src/styles/host-desktop.css`；base `Message.css` 零改动）。

### 实现

- `Message.tsx` 的 `renderer.link`：解析出的 label 去掉内联标签后匹配 `^\s*(?:[a-z][a-z0-9+.-]*:\/\/|\/\/)`（即显示文本本身就是地址）→ 输出 `class="address-link"`；描述性链接不加类，继续继承正文 UI 角色。
- `host-desktop.css`：`.markdown-content a.address-link` 与正文裸路径链接 `.markdown-content a.file-path-link` 绑 `font-family: var(--vscode-editor-font-family); font-size: 13px; overflow-wrap: anywhere; word-break: break-word`。折行只能靠 `anywhere/break-word`（地址无空格），这条同时兜住 `linkifyFilePathText` 在正文生成的裸路径链接，使「路径」在正文与代码里字形一致。
- 链接颜色/下划线不动（**本条为提交 `d8a09697` 时的状态**；D-01 已同日实施并修订，最终为「常态无下划线，hover / focus 时显示」，见提交 `634a85d8` / `33c800c8` 与下文「正文内联链接下划线时机」节）。

### 前后实测（1440px；light/dark 同值）

| 形态                                                                                                                     | 修复前     | 修复后                       |
| ------------------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------- |
| 描述性链接 · 5 个（样式规范 / MDN / 跳转到指标表 / 发送邮件 / 协议相对链接）                                             | UI 栈 14px | UI 栈 14px（未加类、无覆盖） |
| 直显地址 · 6 个（`example.com/docs`、`very/long`、`report/2026`、`coverage…&anchor`、`localhost:8899`、`192.168.1.100`） | UI 栈 14px | **Menlo 13px**               |
| `<code>` 内路径 / 地址链接 · 17 个                                                                                       | Menlo 13px | Menlo 13px                   |
| bash 输出内地址 · 1 个                                                                                                   | Menlo 13px | Menlo 13px                   |

- **长地址折行**：最长样例（多层 query + `&anchor`）折 4 行，所在段落 `scrollWidth == clientWidth`（overflow 0）；表格单元格内地址由 1 行变 2 行（Menlo 步进更宽 → 折行，而非挤在同一格）；`.messages-container` `800 == 800`、`documentElement` `1440 == 1440`，四档视口均无横向溢出。
- **副作用（如实记录）**：Menlo 13px 的字符步进略大于 UI 14px，含直显地址的段落自身行数可能 +1（最长地址段 4 → 5 行），地址链接盒宽 +9%~25%。这是「地址用等宽」的必然结果。
- **IDE 宿主**：新规则带 `[data-host="desktop"]`；`class="address-link"` 仅作标记，IDE 无对应样式 → 保持原 UI 字体。
- **测试**：`pnpm -F wave-webview run type-check` exit 0；提交前全仓 `pnpm -r type-check` 通过；仓库内无链接样式断言，结论以浏览器 computed 值为准。
- 截图 24 张：`/Users/ailsa/Documents/07-AI/走查/截图/F-16-链接角色_修复前|修复后_{light,dark}_{描述性链接与直显地址,锚点链接与裸地址,超长地址折行,路径链接对照,列表内长地址折行,表格内地址折行}.png`（「修复前」= 同页等效回退态）。

### 未覆盖 / 待拍板

- ~~`mailto:` / `tel:` 等无 `//` 的地址若被直接展示，当前判据不算「直显地址」（仍 UI 字体）——是否纳入规则待你确认。~~ **同日闭环**：用户追加规则后已纳入直显地址（见下节「邮箱与电话纳入直显地址」）。
- markdown 链接 label 内嵌套地址（`[https://x](https://y)`）、label 含内联 HTML（`**http://x**`）、自动链接在流式未闭合状态下的判定均未验证。
- ~~D-01（正文内联链接常态下划线）未实施~~ **同日已实施**（提交 `634a85d8`），并当日修订为「常态无下划线，hover / focus 时显示」（提交 `33c800c8`，见下节「正文内联链接下划线时机」）。

## 邮箱与电话纳入直显地址（用户规则 2026-09-10 追加）：判据是可见文字含义，不是有无 `//`（F-16 续）

用户 2026-09-10 追加条款：

1. 直接显示**邮箱、电话号码**或 `mailto:…`、`tel:…` 串 → 使用 13px 等宽字体；
2. 显示「发送邮件」「联系我们」「拨打电话」等**描述性文字** → 使用 UI 字体；
3. **保留原有跳转行为**（`href` 不变）；
4. 判据是**可见文字的含义**，而不是有没有 `//`。

**应用提交：`3b33d294`**（`src/components/Message.tsx`，仅链接判定；`host-desktop.css` 复用 `d8a09697` 的 `a.address-link` 规则）。

### 实现

`Message.tsx` 新增三条判据，`renderer.link` 对 `stripFilePathLinks(text)` 后的可见文本做 `isAddressLabel` 判定：

```ts
const EMAIL_LABEL = /^[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+$/;
// 电话：纯数字 + 分隔符（+ - ( ) 空格 .），至少 7 位数字（含国家码写法）
const PHONE_LABEL = /^\+?[\d(][\d\s().-]{5,}\d$/;
// 日期样 label（2026-09-10 / 2026.9.10）不算电话
const DATE_LABEL = /^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/;
const isAddressLabel = (label: string) => {
  const t = label.replace(/<[^>]*>/g, "").trim();
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|\/\/)/i.test(t)) return true; // scheme 地址
  if (/^(?:mailto|tel):/i.test(t)) return true; // 显式 mailto:/tel: 串
  if (EMAIL_LABEL.test(t)) return true; // 直接显示邮箱
  // 直接显示电话：≥7 位数字且不是日期
  return (
    PHONE_LABEL.test(t) &&
    !DATE_LABEL.test(t) &&
    (t.match(/\d/g) || []).length >= 7
  );
};
```

说明：`mailto:`/`tel:` 的可见 label 本身即地址（无空格、绝对可断点可控），故与 URL 同档；判定发生在 `renderer.link`，不触碰 `href`，跳转行为不变。日期排除是为了避免 `2026-09-10` 这类正文日期被误判成电话。

### 前后实测（1440px；light/dark 同值）

| 形态                                                                                              | 修复前     | 修复后                     |
| ------------------------------------------------------------------------------------------------- | ---------- | -------------------------- |
| 直显邮箱 · 3 个（纯文本 `support@corp.netease.com`、`[support@…](mailto:…)`、`mailto:support@…`） | UI 栈 14px | **Menlo 13px**             |
| 直显电话 · 1 个（`[+86 138 0000 0000](tel:+8613800000000)`）                                      | UI 栈 14px | **Menlo 13px**             |
| 描述性链接 · 9 个（含「发送邮件」「联系我们」「拨打电话」「转接客服」）                           | UI 栈 14px | UI 栈 14px（未加类）       |
| `<code>` 内路径 / 地址链接 · 17 个                                                                | Menlo 13px | Menlo 13px                 |
| 日期样 label（`2026-09-10`）                                                                      | UI 栈 14px | UI 栈 14px（未误判为电话） |

- **跳转行为**：`href` 逐字节不变（`mailto:` / `tel:` 原样输出），仅 class 标记与字形变化。
- **测试**：`pnpm -F wave-webview run type-check` exit 0。
- 截图 8 张：`/Users/ailsa/Documents/07-AI/走查/截图/F-16-邮箱电话角色_修复前|修复后_{light,dark}_{直显,描述性}.png`（「修复前」= 同页等效回退态：中和 `.address-link` 的等宽/字号声明）。

### 未覆盖

- label 与 href 不同源的链接（如 `[https://x](https://y)`）；label 内含内联 HTML（`**http://x**`）；超长电话（>15 位）与带分机号写法；IDE 宿主真机。

## 正文内联链接下划线时机（用户 2026-09-10 授权 + 当日修订）：D-01

> **决策沿革（以本段为准）**：用户先授权「正文内联链接常态显示下划线，hover 加深」（提交 `634a85d8`），当日随即修订为 **「常态无下划线，hover / focus 时显示」**（提交 `33c800c8`）。下面记录修订后的最终状态，末尾保留初版记录备查。

依据：**用户 2026-09-10 决策与修订**——「正文内联链接常态显示下划线，hover 加深。直接展示的 URL、邮箱、电话号码出现在正文中时同样适用；等宽字体不能替代链接的可点击线索。独立工具入口与文件路径链接保留此前已确定的处理方式。」→ 修订为「**常态无下划线，hover / focus 时显示**」。相关背景：**WCAG 1.4.1**（axe `link-in-text-block` serious：链接与正文对比 light 2.9:1、dark 1.99:1，均 < 3:1）。契约中「链接无下划线」表述已声明为 Vue 参考、不再约束 React 侧，故实现不构成契约冲突；该表述的回写建议见 W-05。

**应用提交：`33c800c8`**（当前状态；初版为 `634a85d8`）——`src/styles/host-desktop.css`，base `Message.css` 零改动，IDE 宿主不受影响。

### 实现（修订后）

```css
[data-host="desktop"] .markdown-content a {
  text-decoration: none;
}
[data-host="desktop"] .markdown-content a:hover,
[data-host="desktop"] .markdown-content a:focus-visible,
[data-host="desktop"] .markdown-content a.file-path-link:hover,
[data-host="desktop"] .markdown-content a.file-path-link:focus-visible {
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
}
[data-host="desktop"] .markdown-content a:hover {
  color: #1f47b8; /* derived：--cc-text-link 加深（契约无 hover token） */
}
[data-host="desktop"][data-theme="dark"] .markdown-content a:hover {
  color: #7fc0ff; /* derived：深色下提亮以体现「加深」反馈 */
}
```

`a:focus-visible` 是本次修订新增的一支：键盘 `Tab` 到达链接时同样给出下划线，避免「hover / focus 时显示」只覆盖鼠标。

### 前后实测（探针断言，light / dark 同值）

| 形态                                         | 初版（常态下划线）         | 修订后（当前）                                                         |
| -------------------------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| 正文内联链接 · 常态                          | 下划线（offset 2px / 1px） | **无下划线**，颜色 `#2f5edb` / dark `#4daafc`                          |
| 正文内联链接 · hover                         | 下划线 + 加深              | **下划线 + 加深**：light `#2f5edb → #1f47b8`、dark `#4daafc → #7fc0ff` |
| 正文内联链接 · 键盘 focus                    | 未处理                     | **下划线**（`:focus-visible` 命中）                                    |
| 文件路径 / `code` 内 / 工具输出 / write 路径 | 常态无、hover 有           | 常态无、hover / focus 有（保留既有处理）                               |
| axe `link-in-text-block`                     | 1 节点 / 模式              | **7 节点 / 模式（serious）**                                           |

- **无障碍影响（如实记录，属已接受的偏离）**：修订后静态态回到「只有颜色一个线索」，而链接与正文对比 light 2.9:1 / dark 1.99:1 低于 WCAG 1.4.1 在依赖颜色区分时要求的 3:1 → axe <code>link-in-text-block</code> 报 **7 节点 serious**（常态下划线方案时为 1 节点）。按用户修订决定，该项**不计为验收失败**；若后续要恢复合规：① 回到「常态下划线」，或 ② 提高链接色对比至 ≥3:1。
- **hover token 说明**：契约无「链接 hover」token → hover 色按 `--cc-text-link` 加深/提亮推导，CSS 内已注明 `derived`；**待确认取值或指定官方 token**。
- **测试**：`pnpm -F wave-webview run type-check` exit 0。
- 截图 8 张：`/Users/ailsa/Documents/07-AI/走查/截图/D-01v2-链接下划线时机_修复前_常态_{light,dark}.png`（等效回退到初版「常态下划线」）+ `D-01v2-链接下划线时机_修复后_{常态,hover,focus}_{light,dark}.png`（focus 图为真实键盘 `Tab` 到达链接后拍摄）。初版截图 `D-01-正文链接下划线_*` 保留备查。

### 初版记录（提交 `634a85d8`，已被上述修订取代，仅备查）

CSS 与上表「初版」列一致：`.markdown-content a` 常态 `text-decoration:underline`（offset 2px / 1px），`a:hover` 加深为 `#1f47b8` / `#7fc0ff`，`a.file-path-link` 与 `code a` 显式 `none`、`a.file-path-link:hover` 出现下划线；axe 由 5 → 1 节点。

## 表格阅读效果待验收（V-01）：字号修复已完成，「12→40」口径澄清

### 「12→40」是什么统计

用户 2026-09-10 要求先说明口径：**既不是整张表的总行数，也不是单元格的行数总和**，而是「**折行单元格数**」——内容折成 >1 行的 `td`/`th` 个数。分母 = mock 中 5 张表的 128 个单元格。

| 状态                                     | 折行单元格数 | 8 列表 | 4 列表 |
| ---------------------------------------- | ------------ | ------ | ------ |
| S1 修复前（12.6px 字号、无链接折行规则） | **12**       | 0      | 12     |
| S2 字号已修 14px、链接折行规则未加       | **40**       | 28     | 12     |
| S3 当前 HEAD（含 `a.address-link` 折行） | **33**       | 21     | 12     |

单元格最多折 4 行，≥3 行的单元格由 3 → 5 个。S2 的 +28 主要来自 8 列表：字号从 12.6 → 14px 后列宽不变而文本变宽，更多单元格越过列宽阈值。

### 列宽策略取舍（待拍板）

| 策略                                       | 8 列表           | 4 列表                              | 折行单元格       | 横向滚动       |
| ------------------------------------------ | ---------------- | ----------------------------------- | ---------------- | -------------- |
| ① 现状 `width:100%`                        | 760px / 高 562px | 760px / 高 446px（最窄列 **42px**） | 21 + 12 = **33** | 无（列被压缩） |
| ② 候选 `width:max-content; min-width:100%` | 867px / 高 360px | 1838px / 高 199px                   | 0 + 2 = **2**    | 表格区域内滚动 |

最窄列 42px 的取值内容形如「代码/路径/项目」等短词，属「逐字挤成窄列」的观感问题。

### 用户四条验收口径与当前满足情况

1. 普通说明文字允许自然换行 → ✅ 正文段落行盒总数与修复前一致（未因表格改动而变）；
2. 邮箱、路径、URL 允许必要换行，避免逐字挤成窄列 → ⚠️ 折行已按需（`anywhere`），但 4 列表最窄列仍 42px，取决于策略选择；
3. 宽表优先合理分配列宽，必要时表格区域内横向滚动 → ⚠️ 现为压缩列宽而非分配列宽，策略 ② 可满足；
4. 不截断或隐藏内容来减少行数 → ✅ 无 `text-overflow:ellipsis` / `overflow:hidden` / `display:none`；画布无横向溢出（`documentElement.scrollWidth == clientWidth == 1440`，`.md-table-scroll` 单元格 800 == 800）。

**结论：字号修复已完成（表格保持 14px，未通过缩小字号解决折行），表格阅读效果待验收** —— 待用户选定列宽策略后按四条口径回归并补截图。

截图 8 张：`/Users/ailsa/Documents/07-AI/走查/截图/F-03-表格阅读效果_修复前|修复后_{light,dark}_{宽表4列,8列表}.png`（同一窗口、1440px、同一滚动位置）。

## skill 回写建议汇总（W-01 ~ W-12，仅建议，未改 skill）

按用户要求本轮**只整理、不直接修改** `codechat-desktop-skill`。目标文件与来源：

| #    | 目标文件                                                             | 建议内容                                                                                                                                                                                                                                                 | 依据来源                                                                                                                               |
| ---- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| W-01 | `references/conversation-surfaces.md:51`                             | 对话内块圆角 8px → **12px**（bash / 写入预览 / 代码块 / diff / 答案框）                                                                                                                                                                                  | Figma 节点 `13438:8029` + 用户 0903 第 3 轮评论（已确认）                                                                              |
| W-02 | `references/conversation-surfaces.md`                                | 时间线状态点 8×8+1px → **12×12 + 2px**（浅色白描边 / 深色会话画布色描边），行缩进 20px                                                                                                                                                                   | Figma 节点 `13583-2226`（file `v92f0XaCeMV7467qzIh6en`，已确认）                                                                       |
| W-03 | `references/conversation-surfaces.md:25-27`                          | 连接线 **#E4E7ED / left 5.5px / 端点 21px**，说明源自 12px 节点圆心几何                                                                                                                                                                                  | Figma 提取「竖线 1x541 #E4E7ED」+ 几何推导                                                                                             |
| W-04 | `references/conversation-typography.md`（建议新增 **TXT-09**）       | **链接角色条款**：描述性链接 = 正文角色；直显地址（`http(s)://`、协议相对 `//`、**可见文字本身就是邮箱/电话或 mailto:/tel: 串**）= 代码角色 13px、允许任意位置折行；判据是可见文字含义而非有无 `//`；路径与代码内链接沿用代码角色                        | 用户 2026-09-10 规则；实现 `d8a09697` / `3b33d294`                                                                                     |
| W-05 | `references/conversation-surfaces.md` + `conversation-typography.md` | 「链接无下划线，hover 出现」→ **「正文内联链接常态无下划线，hover / focus 时显示下划线（offset 2px / 1px）并加深颜色；直显 URL/邮箱/电话同样适用；文件路径与代码内链接跟随同一时机」**，并注明无障碍条件（链接与正文对比需 ≥3:1 才免于 WCAG 1.4.1 违规） | 用户 2026-09-10 授权与当日修订 + axe `link-in-text-block`（light 2.9:1 / dark 1.99:1 < 3:1，属已知偏离）；实现 `634a85d8` / `33c800c8` |

### 本轮补充的回写候选（W-06 ~ W-12，用户 2026-09-10「之前修复的内容也可回写」）

| #    | 目标                                                   | 建议内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 依据                                                                                                                            |
| ---- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| W-06 | `conversation-surfaces.md`（结构）                     | **React 桌面端已验收规格的落点**——该文件顶部声明「Vue 参考、非 React 已验收规格」，而圆角 12px / 状态点 12×12+2px / 连接线 / 行高 22px / 表格 14-22 全是 React 实测值，需三选一定落点（原文件并列小节 / 新建 `conversation-surfaces-desktop.md` / 每条加实测行内注）                                                                                                                                                                                                           | 本轮走查过程本身（本文档全篇为 React 实测）；**须先决策，W-01/02/03/05 的写入位置取决于它**                                     |
| W-07 | `design-system.md` / `interaction-states.md`           | 补链接 hover 色：常态 `--cc-text-link`，hover 浅色 `#1F47B8` / 深色提亮 `#7FC0FF`（深色「加深」= 提亮）                                                                                                                                                                                                                                                                                                                                                                        | 实现提交 `33c800c8`（当前按 `--cc-text-link` 推导、标 `derived`）                                                               |
| W-08 | `conversation-typography.md`（TXT-06 注）              | TXT-06 补可执行验收：DOM 确认存在真实滚动容器 + 画布无溢出；陷阱 = renderer 包裹的滚动 `div` 不在 sanitizer 白名单会被剥掉（假通过）                                                                                                                                                                                                                                                                                                                                           | F-06 排查（提交 `1e2ef0aa`：`wraps: 0` → `ALLOWED_TAGS` 缺 `div`）                                                              |
| W-09 | `conversation-typography.md`（TXT-09 附）              | TXT-09 附边界示例表：描述性 = 正文；直显地址/邮箱/电话/`mailto:`/`tel:` = 代码 13px；**日期样 label 不算电话**；未覆盖边界需回报                                                                                                                                                                                                                                                                                                                                               | 用户 2026-09-10 规则 + 提交 `3b33d294`                                                                                          |
| W-10 | `conversation-surfaces.md`                             | 任务列表卡：内边距上下对称 8px、`gap 6px`、圆角 8px；贴合队列卡时去圆角 / 去重边框、保留单条分隔线                                                                                                                                                                                                                                                                                                                                                                             | 用户 0909 走查「下面高了点可以收拢」+ 提交 `2187d55f`（⚠️ 在 `feat/0909-new-base-r1`，**PR 未合并**）                           |
| W-11 | `design-system.md`（菜单节）                           | 菜单分隔线条件渲染：其后无分组内容时不渲染（workdir 菜单无最近记录时隐藏）                                                                                                                                                                                                                                                                                                                                                                                                     | 用户 0909 走查「还未选择工作目录不显示分割线」+ 提交 `61df5d5f`（⚠️ 同上，**PR 未合并**）                                       |
| W-12 | `audit-rubric.md`（无障碍节）+ `interaction-states.md` | 无障碍**实现陷阱**（不只写目标）：① renderer 产出的 `aria-label`/`tabindex` 必须同提交进 sanitizer 白名单（否则被静默剥掉）；② 可滚动区域本体要 `tabindex="0"`；③ 可聚焦元素焦点环 `outline: 2px solid var(--cc-border-focus)` + `outline-offset: 1px`，`:focus-visible` 触发；④ 折叠标题用 `<button type="button" aria-expanded>` 并复位 UA 样式；⑤ 复选框保留本体 + `aria-label`，禁用 `aria-hidden`；⑥ **验收必须走键盘 Tab 路径**（程序化 `focus()` / 鼠标路径不出焦点环） | 用户 2026-09-10 授权批 1（F-08…F-13）；axe 实测 `label` 6→0、`scrollable-region-focusable` 5→0；提交 `9a8bf500`（与 W-08 同源） |

**建议回写顺序**：① 先决策 W-06 落点 → ② W-01/W-02/W-03/W-05 写内容 → ③ W-04/W-07/W-08/W-09/W-12 写 typography、design-system 与无障碍节 → ④ W-10/W-11 待 0909 PR 合并后再写。

**交接单**：`/Users/ailsa/Documents/07-AI/CC02/skill-backfill-for-codex.md`（含一段可直接发给 codex 的提示词 + 12 条逐条「现状原文 / 建议改为 / 依据 / 验收」+ 依赖边界 + 自查清单；Artifact `https://codechat.codewave.163.com/code/artifact/6lfkrp9xgh`）。清单 HTML 的「skill 回写建议汇总」节提供两个一键复制按钮（复制全部 W-01~W-12 / 复制交接单全文）。

**回写前置依赖**：W-04 与 W-05 相互依赖（W-04 让直显地址转等宽、W-05 规定其下划线时机），两条须同批回写；W-12 与 W-08 同源（同属「契约结论必须落到 DOM 实证」的实现陷阱），建议同批写；另基础仓库 `specs/ui/file-path-links.md` 的「路径链接 dotted 下划线」与 base `Message.css` 现有 `underline dotted` 需一并核对（本轮未改 base，IDE 宿主不受影响）。

**本轮（2026-09-10）已落盘但未推送的提交**：`1e2ef0aa`（F-02~F-06 字号/行高/表宽）、`0df55f8b`、`89bfc8f3`（文档）、`d8a09697`（链接角色/地址）、`3b33d294`（邮箱/电话）、`634a85d8`（下划线初版）、`33c800c8`（下划线时机修订）。推送目标仍为「新分支 + PR」，待用户确认后执行。

## 批 1 · 无障碍与行高（用户 2026-09-10 授权：先做批 1，F-08/F-09/F-10/F-11/F-12/F-13 六条）

用户从走查清单 `64zt1y22an` 里选定「先做批 1（无障碍 + 行高）」：F-09 / F-10 / F-11 / F-13，另含 F-08（状态色语义 token）与 F-12（错误块去斜体）。六条**全部有契约或既有约定依据**，无设计取值待决。

### 依据与落点

| 项   | 依据                                                                                   | 落点                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-09 | WCAG 4.1.2；axe `label` **critical**（两模式各 6 节点）                                | `Message.tsx` 新增 `renderer.checkbox`（+ sanitizer 放行 `aria-label`）                                                                                |
| F-10 | WCAG 2.1.1；axe `scrollable-region-focusable` **serious**（两模式各 5 节点）           | `Message.tsx` `renderer.code` 补 `tabindex="0"`；`bash-command-output` / `write-preview-scroll` 补 `tabIndex`；焦点环在 `host-desktop.css`             |
| F-11 | WCAG 2.1.1 / 4.1.2；interaction-states.md「可见焦点、可访问名」                        | `ReasoningBlockView.tsx` / `CompactBlockView.tsx` 折叠标题 `<div onClick>` → `<button type="button" aria-expanded>`；`Message.css` 复位 button UA 样式 |
| F-12 | 角色表**无斜体角色**（中文斜体尤伤可读性）                                             | `host-desktop.css` 只去 `font-style: italic`，字体/行高随 F-01/G2 收敛，不另写覆盖                                                                     |
| F-13 | 角色表「时间/数量/依赖等辅助信息 = 12/20」+ design-system.md 紧凑行高 20px             | `host-desktop.css` 桌面覆盖 `.compact-params` / `.write-tool-stats` 行高 → 20px                                                                        |
| F-08 | codechat `theme/desktop-colors.css:78-83`（light）/`:173-178`（dark）状态 token 权威档 | desktop token 层补 `--cc-state-*` 浅/深两档；`statusColors.ts` 改 `var(--cc-state-*, fallback)`；任务 dot/icon 去掉 hex `!important`                   |

### 实现要点与踩坑

- **sanitizer 白名单是隐性闸门**：`aria-label`（F-09）与 `tabindex`（F-10）都不在 `ALLOWED_ATTR` 里，DOMPurify 会静默剥掉 → 修复到不了 DOM（与 F-06 的 `div`/`ALLOWED_TAGS` 是同一类坑）。本次已把两属性加入白名单，并在注释里写明来源仅限本文件 renderer。
- **`renderer.checkbox` 逐字节对齐 marked 9 默认输出**（`<input ` + `checked="" ` + `disabled="" type="checkbox">`），只追加 `aria-label="已完成/未完成"`；保留 `checked`（完成状态的唯一载体），不用 `aria-hidden` / `role="img"` 隐藏控件。
- **`renderer.code` 只在 `<pre` 开标签插入 `tabindex="0"`**，其余（语言类名、转义状态、`<code>` 子节点）转调默认实现，不引入高亮或结构变化。全部 12 个 markdown `pre` 均可聚焦（其中 4 个当前实际横向溢出）。
- **`--cc-state-*` 只定义在深色块里是既有缺口**：浅色块此前没有焦点环/状态色变量，一旦写法写成无 fallback 的 `var(--cc-border-focus)` 就会在浅色下失效（本轮实测踩到：`outline: 2px solid var(--cc-border-focus, #a0a5a8)` 带 fallback 才两模式都成立）。`statusColors.ts` 全部带 fallback（IDE 宿主不定义这些 token → 回落现值 hex，观感零回归）。
- **F-11 button 复位的边界**：折叠标题元素类型变更必然影响 IDE 宿主，故复位规则写在 base `Message.css`（`button.reasoning-header{width:100%;padding:0;border:none;background:none;font:inherit;color:inherit;text-align:left}`），外观与原先 div 一致；焦点可见样式只在桌面层给（`2px var(--cc-border-focus)`）。

### 前后实测

| 形态                                   | 修复前                                                               | 修复后                                                                                                                                                   | 证据                     |
| -------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| F-09 axe `label`                       | light 6 / dark 6 节点（critical）                                    | **0**                                                                                                                                                    | axe 复跑                 |
| F-09 DOM                               | `<input checked disabled type=checkbox>`                             | 6 个 checkbox 全部带 `aria-label`（已完成 ×3 / 未完成 ×3）                                                                                               | 探针                     |
| F-10 axe `scrollable-region-focusable` | light 5 / dark 5 节点（serious）                                     | **0**                                                                                                                                                    | axe 复跑                 |
| F-10 键盘                              | `pre` / bash 输出 / 写入预览不可聚焦                                 | Tab#15 命中 `pre`、Tab#50 命中 bash 输出、写入预览由前一个可聚焦元素 Tab 命中，焦点环 `2px #A0A5A8`                                                      | 键盘探针                 |
| F-11 键盘                              | `<div onClick>` 无 role/tabIndex/aria-expanded                       | `<button type=button aria-expanded>`，Tab#4 可达，Space/Enter 均切换 `aria-expanded`，焦点环可见                                                         | 键盘探针                 |
| F-12 `font-style`                      | `.tool-error` / `.message.assistant .error` = italic                 | 两者 = **normal**（字号 14px / 助手错误行高 22px 不变）                                                                                                  | 探针                     |
| F-13 辅助行高                          | `.compact-params` 12/18，`.write-tool-stats` 12/normal               | 两者 **12/20**；工具行块高 18px 不变（无布局回归）                                                                                                       | 探针                     |
| F-08 状态色                            | `--cc-state-*` 未定义（空），JS/CSS 双侧 hex，注释「深色沿用浅色值」 | token 两档：light `#16a34a/#2f5edb/#e6a23c/#d92d20/#98a2b3`、dark `#83d6a0/#8bbcf0/#e8bf78/#f19b95/#a0a5a8`；任务 dot、行 icon、时间线节点最终色 = token | 探针（两模式逐元素 rgb） |

- **焦点环触发条件（实测结论，写进说明以免误判）**：`:focus-visible` 只在**键盘路径**出现——纯鼠标点击后用脚本 `.focus()` 聚焦不画环（Chrome 语义正确）。故 F-10/F-11 截图全部走「Tab 键盘路径」采集。
- **F-13 视觉量级**：行高 18 → 20 只在行盒内部生效，工具行块高仍为 18px，故截图差异体现在文件统计行（82 → 85px）与行距，不是布局位移。
- **F-08 截图口径**：「修复前」= 同页等效回退（inline 覆盖 `--cc-state-*` 为浅色值，即原「深色沿用浅色值」状态），不切分支。
- **测试**：`pnpm -F wave-webview run type-check` exit 0；`oxlint` 5 个改动文件 0 warning / 0 error。
- **截图 34 张**：`/Users/ailsa/Documents/07-AI/走查/截图/批1-*.png`（F-08 任务状态/时间线 × light·dark × 前/后、F-09、F-10 代码块/命令输出/写入预览、F-11、F-12、F-13；截图前统一冻结动画以避免断言噪声）。

### 未做（批 1 之外的保留项）

- F-10 的 `.md-table-scroll` 未补 `tabindex`：当前两模式下均无横向溢出（axe 0 违规），待宽表滚动场景复现再定；
- `.tool-error` 容器自身 `line-height: normal`（其内容只有一个 `pre` 原始堆栈，走代码角色）未改，属 F-05/G2 未覆盖的角落，若要求统一再单独处理。

## 代码角色行高 20px（用户 2026-09-10 指示）：行内 code / pre / pre code（F-04 续）

依据来源：**用户 2026-09-10 本窗口指示**「F-04 行内 code / pre / pre code 行高优化为 20px」。契约 `references/conversation-typography.md` 角色表代码角色为「13/20」，其中 13px 属既有约定，20px 原本是候选 C-02 的取值；本次按指示先把 F-04 的**三类载体**落地为 20px。

**改动位置**：`packages/webview/src/styles/host-desktop.css`（`[data-host="desktop"] .markdown-content :not(pre) > code, .markdown-content pre, .markdown-content pre code` 规则，原仅 `font-size`）。选择器新增 `pre code`（原先靠 `inherit` 继承 pre 的行高）；`line-height: 20px` 为新增。base `Message.css` 未改（其 `.markdown-content pre{line-height:1.4}` 由桌面覆盖压过）。

### 前后实测（1440px，light；dark 同值）

| 载体                                     | 修复前                                 | 修复后          | 说明                                           |
| ---------------------------------------- | -------------------------------------- | --------------- | ---------------------------------------------- |
| 行内 code（`:not(pre) > code`，全页 49） | 13px / `normal`                        | **13px / 20px** | 字号不变，行高显式化                           |
| `pre`（全页 16 处）                      | 13px / 18.2px（base 1.4 × 13，非整数） | **13px / 20px** | 消掉 18.2px 小数，与辅助信息角色同刻度         |
| `pre code`                               | 13px / 18.2px（继承 pre）              | **13px / 20px** | 显式绑定，不再依赖继承                         |
| blockquote / li 内的行内 code            | 13px / `normal`                        | **13px / 20px** | 同一规则覆盖（点选 6 处实测）                  |
| 对照：正文 p / li 行盒                   | 22px / 行盒 2、1；p 块高 44px          | **完全不变**    | 行内 code 是 inline 元素，行盒由父级 22px 主导 |

- **零回归（像素级）**：行内 code 段落窗口 796×103 在**浅深两主题下「修复前」「修复后」截图逐字节完全一致**（`cmp` 通过）；`pre` 块高 44 → 46px（2 行各 +1.8px），位移只落在代码块自身。
- **截图前断言主题**：两主题各自数值一致；IDE 宿主不受影响（规则带 `[data-host="desktop"]`）。

### 测试与截图

- `pnpm -F wave-webview run type-check` exit 0；仓库内无对应样式断言，结论以浏览器 computed 值为准。
- 截图 8 张：`/Users/ailsa/Documents/07-AI/走查/截图/F04-代码行高20px_{修复前,修复后}_{light,dark}_{代码块pre,行内code段落}.png`（「修复前」= 同页等效回退态，注入 `pre{line-height:1.4 !important}` 等中和规则）。

### C-02 收口（用户 2026-09-10 同日追加授权「C-02 一起做」）

角色表代码角色为「行内代码、命令、代码块、diff、文件预览、原始日志 = 13 / 20」。F-04 只做了行内 code / pre / pre code，本批把其余代码载体一并收到 20px（**只改行高，不动字号**）：

| 载体                                                 | 规则位置                      | 修复前                        | 修复后          |
| ---------------------------------------------------- | ----------------------------- | ----------------------------- | --------------- |
| bash 命令（`.bash-command-input` / `.bash-command`） | `host-desktop.css` C-02 规则  | 13px / **15.6px**（base 1.2） | 13px / **20px** |
| bash 输出（`.bash-command-output`，含区内链接）      | 同上                          | 13px / **15.6px**             | 13px / **20px** |
| 写入预览（`.write-preview-content`）                 | 其桌面覆盖规则内改（原 18px） | 13px / **18px**               | 13px / **20px** |
| diff（`.diff-viewer-content` → `.diff-line` 继承）   | C-02 + C-02 续（字号）        | 12px / **14.4px**             | **13px / 20px** |
| lsp 输出（`.lsp-output`）                            | C-02 + C-02 续（字号）        | 12px / **14.4px**             | **13px / 20px** |

- **F-15（bash 行高非整数）随之收口**：15.6px 小数消除，取 C-02 的目标值 20px（不再需要 18px 保底档）。
- **几何位移**（1440px，两模式同值）：bash 块 151 → 166px（命令行 27.6→32、输出区 121.2→132）、写入预览 40 → 42px、lsp 输出 24 → 30px、diff 单行 18.4 → 24px；**diff 容器几何不变（302px）**，内容高 2880px 由 `.diff-viewer-content` 的 `overflow-y:auto` 承接（滚到底末行可见，`maxScrollTop 2580`）。
- **无隐藏裁切**：`.bash-command-input` / `.bash-command-output` / `.write-preview-scroll` / `.lsp-output` 均 `overflow:auto`，实测 `scrollHeight == clientHeight` 或可滚到底；画布 `scrollWidth == clientWidth`（无横向溢出）。
- **C-02 续：diff 与 lsp 输出字号 12 → 13px**（用户 2026-09-10 追加指示「diff 与 lsp 输出的字号对齐」）。角色表代码角色为 13/20，这两处此前只对齐了行高。实现：`host-desktop.css` 的 C-02 续规则（`[data-host="desktop"] .diff-viewer-content, .lsp-output { font-size: 13px }`）。
  - **几何零变化（只变字形大小）**：diff 容器 300px、`.diff-line` 24px、`.diff-content` 24px、`.diff-prefix` 20×24、内容高 2880px、**无新增折行**（120 行折行 0 → 0）、无横向溢出（`scrollWidth == clientWidth`）；lsp 输出框高度不变、无横向溢出；画布 `scrollWidth == clientWidth`。
  - 截图逐像素差异（旁证字号确实变大）：diff 查看器 15.5%（light/dark 同值）、lsp 输出 3.8% / 4.0%。
- 截图 24 张：`走查/截图/C02-代码角色行高20px_{修复前,修复后}_{light,dark}_{bash命令与输出,写入预览,diff查看器,lsp输出}.png` + `C02b-diff与lsp字号13px_{修复前,修复后}_{light,dark}_{diff查看器,lsp输出}.png`（「修复前」= 同页等效回退态）。

## 辅助信息角色收口（用户 2026-09-10 指示）：`.tool-result-block` 一族 11px/15.4 → 12/20（F-13 续）

依据来源：**用户 2026-09-10 本窗口指示**「.tool-result-block、.compact-params 统一为辅助 12/20」；契约 `references/conversation-typography.md` 角色表「时间、数量、依赖等辅助信息 = 12 / 20」。

**核对结果**：`.compact-params` 已是 **12/20**（批 1 的 F-13 做过，本轮零改动）；`.tool-result-block` 一族仍是 base 的 **11px / 1.4 = 15.4px**（非整数），低于角色表所有档位（正文 14/22、辅助 12/20、代码 13/20）。

**改动位置**：`packages/webview/src/styles/host-desktop.css`（`.compact-params` 规则之后）：

```css
[data-host="desktop"] .tool-result-block,
[data-host="desktop"] .result-answer,
[data-host="desktop"] .result-raw,
[data-host="desktop"] .tool-result-inline {
  font-size: 12px;
  line-height: 20px;
}
```

`<code>.result-answer</code>` / `<code>.result-raw</code>` 自带 `font-size:11px` 声明，**必须一并列出**，否则只改容器时子元素仍留在 11px；`.tool-result-inline` 未在本轮 mock 中渲染，同族同值一并收口。base `Message.css` 未改（仍是 11px，IDE 宿主行为不变）。

### 前后实测（1440px，light；dark 同值）

| 元素                            | 修复前        | 修复后          | 块高                                                      |
| ------------------------------- | ------------- | --------------- | --------------------------------------------------------- |
| `.tool-result-block`（9 处）    | 11px / 15.4px | **12px / 20px** | 46.2 → 60、61.6 → 80、15.4 → 20（AskUser 卡 152 不变）    |
| `.result-raw`（7 处）           | 11px / 15.4px | **12px / 20px** | 46.2 → 60（`max-height:100px` + `overflow:auto`，不裁切） |
| `.result-raw-line`（17 处）     | 11px / 15.4px | **12px / 20px** | 15.4 → 20                                                 |
| `.result-answer`（1 处）        | 11px / 15.4px | **12px / 20px** | 15.4 → 20                                                 |
| `.ask-user-result-item`（2 处） | 11px（继承）  | 12px（继承）    | 72 不变（子元素 q/a 本是 14/22）                          |
| `.compact-params`（14 处）      | 12px / 20px   | 12px / 20px     | 不变（批 1 已做）；前后截图逐字节一致                     |
| `.ask-user-result-q/a`（2 处）  | 14px / 22px   | 14 / 22（不变） | 正文角色，未动                                            |

- **残留小字号核对**：对话流内 **11px 文字节点 45 → 8**，余下 8 处**全部在 Mermaid SVG 内**（`<text>` / `<tspan>`，角色表明确「不涵盖 Mermaid SVG 内文字」）；**10px 节点**只剩 `.tool-status-dot`（内容是「●」圆点字符，非文字）与 Mermaid 标签。即对话流已无「非角色的 11px 正文文字」。
- **无裁切 / 无溢出**：`.result-raw` 的 `max-height:100px; overflow-y:auto` 承接行高变大后的增高（可滚到底）；画布 `scrollWidth == clientWidth`。
- **测试**：`pnpm -F wave-webview type-check` exit 0。
- **截图 8 张**：`/Users/ailsa/Documents/07-AI/走查/截图/辅助角色-工具结果12px20px_{修复前,修复后}_{light,dark}_{工具结果块,工具参数compact-params}.png`（工具结果块窗口 90 → 108px；compact-params 前后逐字节一致）。

## diff 省略行归辅助角色（用户 2026-09-10 指示）：`.diff-line-ellipsis` 11px → 12px（F-13 续 2）

依据来源：**用户 2026-09-10 本窗口指示**「.diff-line-ellipsis 可以提到 12px」（先由走查确认该元素此前在 mock 里一处都不渲染、补用例使其可见后再定值）；契约 `references/conversation-typography.md` 角色表「辅助信息 = 12 / 20」。

**改动位置**：`packages/webview/src/styles/host-desktop.css`（辅助信息角色收口规则之后，全仓新增，此前 `host-desktop.css` 内无该类覆盖）：

```css
[data-host="desktop"] .diff-line-ellipsis {
  font-size: 12px;
  line-height: 20px;
}
```

- base 值来自 `DiffViewer.css:133`：`font-size: 11px` + `padding: 2px 28px` + `font-style: italic` + `color: descriptionForeground`；**行高不是自己声明的**，是继承 `.diff-viewer-content` 的 20px（C-02 落地后）。11px 落在角色表所有档位之外，故收口到辅助信息 12/20。
- **同类覆盖面**：对话流内 diff 查看器的三态省略行（前置 / 后置 / 中间）+ 右侧预览面板「差异」页（`DiffPane`）的状态行（「二进制文件，不显示差异」/「无内容差异」/「重命名自 …」/「差异过大，已截断…」）——都是同一个类，字号随之一致。
- **`.diff-empty` 不在其列**：该分支在应用内**不可达**（`DiffViewer.tsx:272` 的渲染条件是 `changes.length === 0`，而同组件 49-51 行 `showDiff` 要求 `changes.length > 0`，不满足时 264 行提前 `return null`；全仓仅此一处引用）。属既有死代码，本轮不顺手动它。
- base `DiffViewer.css` 未改 → IDE 宿主仍为 11px。

### 前后实测（1440px；light / dark 同值）

| 用例（mock 内三条 Edit） | 位置         | 修复前      | 修复后          | 元素盒 | 容器 / 卡高    |
| ------------------------ | ------------ | ----------- | --------------- | ------ | -------------- |
| A · 前置省略             | 首行         | 11px / 20px | **12px / 20px** | 758×24 | 144 / 175 不变 |
| B · 后置省略             | 末行         | 11px / 20px | **12px / 20px** | 758×24 | 144 / 175 不变 |
| C · 中间省略             | 两组变更之间 | 11px / 20px | **12px / 20px** | 758×24 | 264 / 295 不变 |

- **几何零位移**：行高两侧同为 20px，只有字形变大 —— 元素盒 758×24 不变、`.diff-viewer-content` 的 `clientHeight == scrollHeight`（144 / 144、264 / 264，无需滚动）、卡片高度 175 / 175 / 295 逐值不变、画布横向溢出 0。
- **逐像素差异**：截图尺寸完全一致（761×175、761×295），差异像素 **44~45 个（0.020%~0.034%）**，bbox 恰好落在省略号字形区域（x 31→49，纵向 ±2px）——即除「...」本身变大外，其余像素零变化。
- **测试**：`pnpm -F wave-webview type-check` exit 0。
- **截图 12 张**：`/Users/ailsa/Documents/07-AI/走查/截图/diff省略行12px_{修复前,修复后}_{light,dark}_{01前置,02后置,03中间}.png`（「修复前」= 同页等效回退，注入 `!important` 强制 11px）。

### 配套：diff 省略行三态走查用例（本地 mock，不入库）

`.diff-line-ellipsis` 只在 diff 上下文被折叠时出现，此前 mock 里 **0 处渲染**，属「按类生效但无法目视验收」。已在本地 `prototype/mockShared.ts` 新增 `richDiffEllipsisMessages()`（3 条 Edit：`src/styles/tokens-{shadow,radius,font}.css`，上下文 **5 / 5 / 7** 行，已用 `diffLines` 实测命中 `DiffViewer.tsx:170-197` 的 `contextLimit = 3` 三条分支）并接进 `richConversationMessages()`，8899 用例「桌面端：对话流全样式」内可见（消息带 `A·` / `B·` / `C·` 前缀）。`prototype/` 与 `mockShared.ts` 均 gitignore，**不进本文件所属的提交**。

## 表格展示（F-07）+ 列宽按内容分配（V-01）（用户 2026-09-10 指示，候选待走查）

依据来源：**用户 2026-09-10 本窗口指示** —— F-07「表头配色可以参考 Bash 的颜色，保持统一；给表格加一下圆角；保留表格描边；斑马纹可以拿掉」；V-01「采用第三种策略：按内容分配列宽，优先自然换行，横向滚动只作兜底」+ 五条验收重点。**本轮只调整表格展示层，不改写 AI 已生成的内容**；走查验收后再整理为 CC 的表格列宽规则。

### 改动 1：`packages/webview/src/components/Message.tsx`（marked 渲染器，判定与内容无关）

- `renderer.table`：包 `.md-table-scroll` 时补 `tabindex="0"` —— 表格被 `.messages-container` 的 `overflow-x:hidden` 裁切时才出现局部横向滚动，滚动区必须键盘可达（与 F-10 同规）。
- `renderer.tablecell`：按**单元格文本内容**注入类名，**不改内容本身**（`DOMPurify` 的 `ALLOWED_ATTR` 本就含 `class`）：
  - `md-cell-token` —— 单 token 且 ≤ 12 字符：分类 / 状态 / 序号 / 数值 / 日期 / 短词；
  - `md-cell-long-token` —— 任一 token ≥ 20 字符，或 ≥ 12 字符且含 `/`、`@`：URL / 邮箱 / 路径 / 长英文串。
- 判定只看「长度 + 分隔符」这类通用文本特征，**不依赖 mock 内容、不绑定某一张表**，其余表格同样生效（阈值常量 `TABLE_CELL_SHORT_TOKEN_MAX = 12` / `TABLE_CELL_LONG_TOKEN_MIN = 20` / `TABLE_CELL_ADDRESS_MIN = 12`）。

### 改动 2：`packages/webview/src/styles/host-desktop.css`

```css
[data-host="desktop"] .markdown-content table {
  border-collapse: separate;
  border-spacing: 0;
  border-radius: 12px;
}
[data-host="desktop"] .markdown-content th,
[data-host="desktop"] .markdown-content td {
  border: none;
  border-right: 1px solid var(--cc-border-light);
  border-bottom: 1px solid var(--cc-border-light);
  overflow-wrap: normal;
  word-break: normal;
}
[data-host="desktop"] .markdown-content th:last-child,
[data-host="desktop"] .markdown-content td:last-child {
  border-right: none;
}
[data-host="desktop"] .markdown-content tbody tr:last-child td {
  border-bottom: none;
}
[data-host="desktop"] .markdown-content th {
  background-color: var(--cc-fill);
}
[data-host="desktop"] .markdown-content tr:nth-child(even) {
  background-color: transparent;
  opacity: 1;
}
[data-host="desktop"] .markdown-content thead th:first-child {
  border-top-left-radius: 12px;
}
[data-host="desktop"] .markdown-content thead th:last-child {
  border-top-right-radius: 12px;
}
[data-host="desktop"] .markdown-content tbody tr:last-child td:first-child {
  border-bottom-left-radius: 12px;
}
[data-host="desktop"] .markdown-content tbody tr:last-child td:last-child {
  border-bottom-right-radius: 12px;
}
[data-host="desktop"] .markdown-content th.md-cell-token,
[data-host="desktop"] .markdown-content td.md-cell-token {
  white-space: nowrap;
}
[data-host="desktop"] .markdown-content th.md-cell-long-token,
[data-host="desktop"] .markdown-content td.md-cell-long-token {
  overflow-wrap: break-word;
}
```

- **表头配色统一到 bash 面**：`--cc-fill`（light `#F0F2F5` / dark `#25292B`）正是 `.bash-command-unified .bash-command-input` 的底色（`--vscode-chat-requestBubbleBackground`，见本文件「bash 命令区」一节），实测 `rgb(240,242,245)` / `rgb(37,41,43)`；base 的 `lineHighlightBackground` 是 25% 透明灰，dark 下完全透明（表头无底色）。
- **斑马纹去掉**：base `Message.css` 的 `tr:nth-child(even){background-color:lineHighlightBackground;opacity:0.8}` 桌面端置为 `transparent / opacity:1` —— 该透明叠加还曾把浅色行正文对比压到 3.52:1（axe 附录），去掉后行底色=画布色。
- **圆角实现**：base 是 `border-collapse: collapse`，折叠边框不参与圆角绘制（实测 0 度转角仍是直角描边、只有底色被裁圆），故改 `separate + border-spacing:0`，单元格只留右/下描边、末列末行去掉与表格外框重复的一侧，四角由表头/末行单元格承担。实测列宽与 `collapse` 完全一致，表高仅末行 −1px（吸收共享边框）。
- **列宽按内容分配（V-01 策略三）**：不用 `width:max-content`、不做等宽列、不给固定百分比。机制是让浏览器自动表格布局按内容分配：短 token 用 `nowrap` 把 min-content 抬到「词」宽 → 短列保底拿到自然宽（不再被压成逐字竖排）；长不可断 token 用 `break-word` 只在放不下时断行；其余文本按词自然折行；整表仍放不下则由 `.md-table-scroll` 局部横滚兜底。**`break-word` 而非 `anywhere`**：`anywhere` 会把 min-content 一起降到 1 字符，浏览器便一直从长内容列抽宽度（实测 480px 下 4 列长内容表路径列被压到 31px 内容宽、说明格折成 28 行、表高 1582px；`break-word` 同表 184px 列宽、表高 441px）。

### 现状 vs 候选实测（同内容、同窗口；light/dark 同值；「现状」= 注入 `!important` 等效回退 base 样式）

| 窗口 / 消息列宽   | 表                              | 现状 列宽                      | 现状 高  | 现状 竖排·断字 | 候选 列宽                       | 候选 高 | 候选 竖排·断字 | 横滚               |
| ----------------- | ------------------------------- | ------------------------------ | -------- | -------------- | ------------------------------- | ------- | -------------- | ------------------ |
| 1440 / 800        | 8 列（组件…备注）               | `[122,216,52,52,60,55,95,106]` | 550      | 14 · 12        | `[122,177,53,53,68,55,106,124]` | 528     | **0 · 0**      | 无                 |
| 1440 / 800        | 4 列（视口宽度…占比）           | `[162,190,190,218]`            | 196      | 0 · 0          | `[162,190,190,216]`             | 196     | **0 · 0**      | 无                 |
| 1440 / 800        | 4 列长内容（项目/值/说明/备注） | `[42,306,364,46]`              | 440      | 7 · 7          | `[54,284,339,81]`               | 352     | **0 · 0**      | 无                 |
| 994 / 733（分屏） | 8 列                            | `[122,174,52,52,55,55,88,94]`  | 550      | 15 · 13        | `[122,110,53,53,68,55,106,124]` | 704     | **0 · 0**      | 无                 |
| 994 / 733（分屏） | 4 列长内容                      | `[41,276,331,44]`              | 484      | 7 · 7          | `[54,252,304,81]`               | 396     | **0 · 0**      | 无                 |
| 480 / 360（窄窗） | 4 列                            | `[76,80,74,89]`                | 240      | 5 · 5          | `[81,95,95,108]`                | 196     | **0 · 0**      | +61（表 381>320）  |
| 480 / 360（窄窗） | 8 列                            | `[122,39,51,50,39,55,65,56]`   | **4752** | 27 · 27        | `[122,81,53,53,68,55,106,124]`  | 946     | **0 · 0**      | +344（表 664>320） |
| 480 / 360（窄窗） | 4 列长内容                      | `[39,209,257,39]`              | 529      | 7 · 7          | `[54,209,257,81]`               | 441     | **0 · 0**      | +283（表 603>320） |

「竖排」= 短 token 单元格（分类/状态/序号/数值/日期）折成 2 行以上（逐字竖排）；「断字」= 非长 token 单元格宽度小于自身自然宽、被迫中途断字。

**用户要的三个数（候选，light/dark 同值）**

1. **最窄内容列宽**：**53px**（内容宽 29px，= 12px 边距 ×2 + 2 个 14px 汉字）——1440 / 994 / 480 三档都是 53px，即短列稳定停在自身自然宽度，不再随窗口变窄（现状最小 39~52px，内容宽 14~28px，已到「一字一列」）。
2. **典型长单元格行数**：1440 —— 8 列表路径列 `209px 自然 → 2 行`，4 列长内容表 `392/380/771/796/765px 自然 → 3/2/4/3/3 行`；994 —— 路径列 `→ 4 行`、说明列 `→ 5 行`；480 —— 路径列 `→ 5 行`、说明列 `→ 6 行`。**折行数不设上限、也不作为优化目标**：候选在 994/480 下折行数反而比现状多（现状那些「少折行」是靠把列压到 14px、把 211px 的路径排成 32 行换来的）。
3. **是否需要横向滚动**：1440 / 994 两档**不需要**（8 列与 4 列都完整落在消息列内，画布横向溢出 0）；**480px 窄窗需要**，由 `.md-table-scroll` 局部承担（8 列 +344px、4 列 +61px、4 列长内容 +283px），页面本身不被撑宽（画布 `scrollWidth == clientWidth`）。滚动区 `tabindex=0`、`overflow-x:auto`。

### 五条验收重点对照

1. **短词不被挤成逐字竖排** —— 竖排格数 **21 → 0**（1440）、**22 → 0**（994）、**39 → 0**（480）；最窄列由 39~52px 抬到 53px（= 自然宽）。
2. **普通说明自然换行、每行可完整左→右阅读** —— 非长 token 的中途断字 **19 → 0**（1440）、**20 → 0**（994）、**39 → 0**（480）；长内容列拿到的正是「剩余空间」（1440 八列表 177px 为全表最宽列、4 列表 284/339px 为最宽两列）。
3. **不以减少折行单元格数量为优化目标** —— 候选在 994（550→704）与 480（八列 4752→946、4 列 529→441）有增有减，规则里没有任何「压缩折行数」的取向，只有「短列保底可读 + 长列吸收剩余」。
4. **放不下的宽表保留局部横向滚动 + 键盘可用，页面不被撑宽** —— 8 列/4 列在 1440、994 不需滚动；480px 下按上表滚 +61~+344px，容器 `tabindex=0` 键盘可滚，**全部 8 组实测画布横向溢出 = 0**。
5. **同内容同窗口前后截图 + 三个数** —— 见本文件「截图」段与上表；截图 24 张：`/Users/ailsa/Documents/07-AI/走查/截图/表格{四列,四列长内容,八列}_{现状,候选}_{light,dark}.png` + `表格四列长内容_分屏994_{现状,候选}_{light,dark}.png` + `表格八列_窄窗480_{现状,候选}_{light,dark}.png` + `表格四列_窄窗480_{现状,候选}_{light,dark}.png`。

### 备注

- **仍待决策**：994px 分屏下 8 列表的「文件路径」列拿到 110px 剩余宽、折 4 行（全表第 3 窄），因为 7 个短列按 `nowrap` 占满各自自然宽后只剩这么多。彻底解法要引入 `min-width`（长内容列保底宽度，代价是真溢出时更早出现横滚），与「优先自然换行、横滚只作兜底」相冲突，故本轮不引入 —— 留给你走查后决定。
- **未动**：base `Message.css` 表格样式与 `font-size:0.9em` 等一律不改（IDE 宿主观感不变）；AI 生成的表格内容（文案、行列）零改写，本轮只有展示层。
- **测试**：`pnpm -F wave-webview type-check` exit 0。

---

## 表格对齐（F-17）（用户 2026-09-10 指示，候选待走查）

用户规则原文（要点）：未声明对齐时表头与单元格**默认左对齐，取消浏览器/公共样式造成的表头默认居中**；同一列表头与正文对齐一致；**数值比较列（数量/金额/百分比/耗时）右对齐**，编号/版本/电话/日期**不因含数字就自动右对齐**；文字状态默认左对齐，**只有纯图标或独立操作列才考虑居中**；多行正文单元格**顶部对齐**；保留 Markdown 显式声明的左/中/右，不用全局 CSS 强行覆盖；**没有明确列类型时默认左对齐，不根据某一个单元格猜整列类型**。来源：GOV.UK 表格规范支持「比较性数字及其表头右对齐」，其余为 CC 产品适配规则。

### 先回答「全部居中从哪来」

实测（`probe-align-current.mjs`，1440px，5 张 mock 表逐列读计算样式）：

| 表格                                             | 是否声明 Markdown 对齐 | `th` 计算值           | `td` 计算值           |
| ------------------------------------------------ | ---------------------- | --------------------- | --------------------- |
| 简单表 / 宽表 8 列 / 富单元格表                  | 否（`\| ---- \|`）     | **center**            | start（= 左）         |
| 列对齐演示表（`\| :----- \| :--: \| -----: \|`） | 是                     | left / center / right | left / center / right |

- **结论：表头居中来自浏览器 UA 的 `th { text-align: center }`，不是 Markdown 声明**——base `Message.css` 只写了 `th[align="…"]` 三档，没有给未声明对齐的表设默认值，于是「表头居中 + 正文左对齐」同列两种对齐。
- **Markdown 显式声明本身是好的**（marked 输出 `align` 属性、base 三档规则正确消费），因此本次**只改渲染默认值**，不动内容层，也不改动 AI 已生成的内容。
- 附带实测：`td` 计算 `vertical-align: middle`，长说明撑高整行时，同行的短词被垂直居中，与「多行正文顶部对齐」不符。

### 改动 1：列级对齐判定（`packages/webview/src/components/Message.tsx`）

新增 `tableColumnAlignClass(headerText, bodyTexts)` + `applyTableColumnAlign(tableHtml)`，在 `renderer.table` 里对默认渲染结果做一次按列注入（不改内容、不改结构，只在开标签上补 class；单元格已有 `align` 属性时**跳过**）：

1. **数值比较列** → `md-cell-right`：列头命中可比量关键词（数量/个数/次数/条数/人数/行数/字数/耗时/时长/响应时间/内存/体积/大小/字节/金额/价格/成本/费用/占比/比例/百分比/覆盖率/通过率/增长率…）**且整列非空单元格都能解析为数值**（容忍千分位、小数、正负号、比较符、货币前缀、`%`、`ms`/`px`/`次`/`元`/`天` 等单位后缀，`—`/`N/A`/`待定` 视为缺失）。任一条件不满足即保持左对齐。
2. **标识列** → 强制左对齐：列头命中 编号/序号/号/ID/版本/ver/电话/手机/传真/日期/时间/date/邮箱/端口/卡号/邮编 时直接返回（即使整列都是数字）。
3. **纯图标列** → `md-cell-center`：整列非空单元格都是图标（`\p{Extended_Pictographic}` 等，≤4 码点），如 ✅/⚠️/❌。
4. **独立操作列** → `md-cell-center`：列头就是「操作/动作/action(s)」且整列都是无空白的短词（≤6 字符），如 查看/编辑/重试。
5. 其余一律 `null`（默认左对齐）。**判定只看整列，不看单个单元格**；不按列序、不按表结构、不按具体 mock 内容，故可复用到任意表格。

### 改动 2：桌面端对齐样式（`packages/webview/src/styles/host-desktop.css`）

```css
/* F-17：默认左对齐 + 顶部对齐；显式 align 与列级 class 各自覆盖 */
[data-host="desktop"] .markdown-content table th,
[data-host="desktop"] .markdown-content table td {
  text-align: left;
  vertical-align: top;
}
[data-host="desktop"] .markdown-content table th[align="left"],
…td[align="left"] {
  text-align: left;
}
[data-host="desktop"] .markdown-content table th[align="center"],
…td[align="center"],
[data-host="desktop"] .markdown-content table th.md-cell-center,
…td.md-cell-center {
  text-align: center;
}
[data-host="desktop"] .markdown-content table th[align="right"],
…td[align="right"],
[data-host="desktop"] .markdown-content table th.md-cell-right,
…td.md-cell-right {
  text-align: right;
}
```

- 选择器统一带 `table` 一级 → specificity `0,3,2`（base 的 `th[align="…"]` 是 `0,2,1`），**稳定压过 base 且不依赖打包顺序**；同时不使用 `!important`。
- 只作用于 `[data-host="desktop"]`，base 与 IDE 宿主观感不变；字号、列宽、换行、滚动策略（F-07/V-01）不在此改动。
- 列宽分类（`md-cell-token` / `md-cell-long-token`）与本轮对齐 class 可同时存在于一个单元格：前者管 `white-space`、后者管 `text-align`，互不冲突。

### 改动 3：验证用例（`packages/webview/prototype/mockShared.ts`，工具链文件，不在推送集）

在 rich-tables 消息末尾追加两张表：**对齐规则表**（组件 / 数量 / 平均响应`<br>`耗时 (ms) / 覆盖率 / 编号 / 版本 / 电话 / 日期 / 状态，含多行表头）与**混合表**（混合内容 / 显式居中 / 显式右对齐 / 单格数字 / 检查项 / 结果 / 操作 / 说明），覆盖用户点名的四类验证内容：混合文本、数值、长路径（沿用上一轮富单元格表）、多行表头 + 多行正文。

### 实测：现状 vs 候选

「列对齐不一致数」= 表头与同列正文计算出的水平对齐不同的列数（`left` vs `start` 视为一致）。

| 视口 / 主题       | 7 张表的列对齐不一致数（现状 → 候选） | 单元格 `vertical-align` | 最窄内容列   | 各表 `scrollWidth/clientWidth` | 画布横向溢出 |
| ----------------- | ------------------------------------- | ----------------------- | ------------ | ------------------------------ | ------------ |
| 1440 light / dark | 2,4,0,8,4,**9**,**6** → **全部 0**    | middle → **top**        | 53px（不变） | 逐表与现状完全一致             | 0            |
| 994 分屏 light    | 同上 → **全部 0**                     | middle → **top**        | 53px（不变） | 一致（761/693、693/693…）      | 0            |
| 480 窄窗 light    | 同上 → **全部 0**                     | middle → **top**        | 53px（不变） | 一致（761/320、596/320）       | 0            |

其中「列对齐不一致数 = 0」的那张是列对齐演示表（三列全部显式声明），现状本来就是对的——说明问题只出在**未声明对齐**的表。

逐列结果（候选，1440）：

- 对齐规则表：组件=左、**数量=右**、**平均响应耗时 (ms)=右**、**覆盖率=右**、编号=左、版本=左、电话=左、日期=左、状态=左。
- 混合表：混合内容（列头像数值但整列含「待确认」「—」）=左、**显式居中=居中（保留 `align="center"`）**、**显式右对齐=右（保留 `align="right"`）**、单格数字（只有一格是数字）=左、检查项=左、**结果（✅/⚠️/❌）=居中**、**操作（查看/编辑/重试）=居中**、说明（多行）=左。
- 多行单元格：说明列撑高到 105px（1440）/127px（994）/369px（480）时，同行的「显式居中/文本/查看」等短内容由垂直居中改为**贴顶**。

### 验收重点对照

1. **表头默认不再居中** —— 未声明对齐的表由 UA center 改为左对齐；7 张表列对齐不一致数 9/8/6/4/2 → **0**。
2. **同列表头与正文一致** —— 上述不一致数归零即该项达标；表头与正文使用同一条列级 class（同一列同一个值）。
3. **数值比较列右对齐、标识列不误判** —— 数量/耗时/占比/覆盖率=右；编号/版本/电话/日期=左；**混合列与「单格数字」列保持左对齐**（不因单个单元格是数字就猜整列）。
4. **文字状态左对齐、图标/操作列居中** —— 状态列左；结果（图标）与操作列居中。
5. **多行正文顶部对齐，且保留既有字号/列宽/换行/滚动** —— `vertical-align` middle → top；**最窄内容列仍 53px、各表 `scrollWidth`/表高与上一轮逐值相同**（如 480 下 8 列混合表 596/320、表高 685，与候选前一致），画布横向溢出 0。
6. **Markdown 显式对齐保留** —— `align="left/center/right"` 三档实测分别为 left/center/right，内容零改写。

### 截图（16 张，`/Users/ailsa/Documents/07-AI/走查/截图/`）

- `对齐_规则表_1440_{现状,候选}_{light,dark}.png`
- `对齐_规则表_994_{现状,候选}_light.png`、`对齐_规则表_480_{现状,候选}_light.png`
- `对齐_混合表_1440_{现状,候选}_{light,dark}.png`、`对齐_混合表_994_{现状,候选}_light.png`、`对齐_混合表_480_{现状,候选}_light.png`
- 「现状」= 注入等价回退样式（未声明对齐时 `th` 恢复 UA center、`td` 恢复 start，`vertical-align` 恢复 middle，显式 `align` 仍走 base 三档规则），保证同内容同窗口可比。

### 备注

- **未改内容层**：AI 生成的表格文案、行列、Markdown 对齐声明一律未动；本轮只有渲染默认值与桌面端样式。
- **base 未动**：`Message.css` 的表格规则保持原样，IDE 宿主不受影响。
- **可检索规则**：右对齐关键词表 / 标识列关键词表 / 图标与操作列判据都写在 `Message.tsx` 顶部常量里，改词表即可扩缩范围，不需要动渲染流程。
- **测试**：`npx tsc --noEmit`（webview）exit 0；三档×两主题实测全部画布溢出 0。

## 插件市场设置页走查修复（0915 批，用户 2026-09-15 授权「除了 F05 其他通过」+ 裁决 D-01/D-02/D-03/D-06/T-01；同日追加焦点环修正）

来源：`走查/0915-插件市场/0915-pluginmarket-走查.html`（Artifact `h2qt8rsv4a`）。走查本身为 audit-only（产品代码零改动）；以下为本批授权后的实施。

### 授权范围（逐条回源）

- **F-01 深色选中的市场筛选胶囊反白**：`.settings-plugin-chip.is-active` → `color: var(--cc-action-primary-text, var(--vscode-button-foreground))` / `background: var(--cc-action-primary, var(--vscode-button-background))`；其内 `.settings-tab-count` → `color: inherit` / `background: transparent`（嵌套角标继承反白对）。深色 1.16:1 → **13.28:1**。
- **F-02「✓ 已安装」小字不可读**：`.settings-plugin-act.is-installed` → `color: var(--cc-text-regular, …)` / `background: var(--cc-color-success-soft, …)`；`hover` → `--cc-text-primary`。浅色 1.51:1 → **6.63:1**，深色 7.22 → **8.77:1**。
- **F-03「· 可更新」版本行不可读**：`.settings-plugin-version.is-update` → `color: var(--cc-text-primary, …)` / `font-weight: 500`（字号属 D-03，未动）。浅色 3.11:1 → **15.78:1**，深色 8.07 → **15.02:1**。
  - F-02/F-03 共同理由：桥接文档「小字状态色不可读时改用可读标签 + 指示」。`--cc-color-success` 浅色 #16A34A 在白底仅 **3.30:1**、`--cc-color-warning` #D97706 仅 **3.19:1**，不能承载 12–13px 文字，故状态含义交给文案与 soft 底，不由色相独担。
- **F-04 深色作用域弹窗选中项说明**：`.settings-scope-option.is-selected` 内的标题 `em` 与 `.settings-scope-option-desc` → `var(--cc-text-regular, …)`（仅选中态内生效）。深色 4.35:1 → **6.37:1**；浅色 5.71:1（未选中项 5.61 未回归）。
- **F-06 键盘焦点环**（0915 修正后，见下节）：设置页统一到 `--cc-border-focus`，修前为浏览器默认蓝 `rgb(0,95,204)`。
- **F-07 计数角标字号**：`.settings-tab-count` → `var(--cc-fill / --cc-text-regular)` + **12px / 16px**（修前 11px + badge token）。浅色 6.19:1 / 深色 8.64:1。
- **D-01 / D-02 几何**：行内「更新/移除市场」**8px 圆角 / 28px 高**（修前 4px / 23px）；「新建市场」与搜索框 **6px / 32px**；「安装·已安装」**8px / 28px / min-width 88px / padding 0 14px**；作用域胶囊 **8px / 28px**。
- **D-03 页头说明**：仅页头说明由 13px → **14px / 22px**（契约档），其余字号项按「不改」保持。
- **D-06 弹窗面**：作用域弹窗表面接 **`--cc-bg-overlay`**（浅 #FFFFFF / 深 #232526）；遮罩按桥接文档「面与遮罩分开决定」保持模态 `rgba(0,0,0,0.4)`，未换轻量 scrim。
- **T-01 浅色 host token 桥接**（`host-desktop.css`，依 skill 新分支 `docs/desktop-theme-bridge`@`6598e6c`）：浅色档补 `--cc-border-focus: var(--cc-action-primary)`；补三条与深色同族的桥接 `--vscode-list-hoverBackground: var(--cc-fill-hover)`、`--vscode-list-activeSelectionBackground: var(--cc-fill-pressed)`、`--vscode-focusBorder: var(--cc-border-focus)`。此前浅色沿用编辑器原值（黑 alpha / VS Code 蓝），同一组件在两模式落到不同值族。

### 焦点环两种语言（0915 修正「双圈 + 空隙」）

用户 2026-09-15 反馈「表单选中态的描边和本身的边框线产生了间距，感觉有两圈边框」。根因：上一版把设置页所有可聚焦控件一刀切套通用外移环（`outline: 2px solid var(--cc-border-focus); outline-offset: 2px`），而 `.settings-page input:focus-visible` 特异性 **(0,2,1)** 高于设置页原有表单语言 `.settings-text-input:focus` **(0,2,0)**，于是输入类与自带 1px 边框的行内按钮 / 作用域胶囊 / 单选卡全部变成「边框变色 + 2px 空隙 + 2px 外环」。

修正后的分工（`SettingsPage.css:34-72`）：

| 控件                                                                                                                         | 焦点表达                                                                     | 依据                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 无边界控件（返回 / 导航项 / 页签 / 筛选胶囊 / 主次按钮）                                                                     | `outline: 2px solid var(--cc-border-focus)` + `outline-offset: 2px`          | skill `theme/layout.css:211`、codechat-ui `src/styles/global.css:44`                                                                            |
| 自身带 1px 边界（输入类 / `.settings-row-btn` / `.settings-scope-pill` / `.settings-scope-option` / `.settings-plugin-act`） | `outline: none`，焦点色落在自身 `border-color`                               | codechat-ui `src/features/settings/settings.css:566`、skill `theme/element-plus.css:114`（输入类显式 `outline: none`，见 settings.css:110/560） |
| 危险操作（`.settings-row-btn-danger`）                                                                                       | 红边保留 + `outline: 2px solid var(--cc-color-danger)`、`offset: 0` 贴边同色 | 保住红色语义，避免异色双圈                                                                                                                      |

实测：`verify-focus-ring-0916.mjs` **14/14**（浅深 × 列表 / 弹窗 / 搜索框；含「无 border+outline(offset>0) 双圈」「每个焦点都有可见指示」「有边界控件焦点色 = `--cc-border-focus`」「危险按钮保红边 offset 0」）；其他设置 Tab（全局设置 / 个性化 / 项目设置 / MCP 服务 × 浅深）**16/16**；`scan-double-ring-0916.mjs` 全产品扫描（外壳 29 步 / 设置页 19 步 / 弹窗 5 步 × 浅深）**双圈 0 处、无焦点指示 0 处**。前后对照用真实 Tab 走到同一元素且前后步数一致（row-btn 13 / danger 14 / search 19 / plugin-act 20 / scope-pill 21），差异像素 1742~3566，bbox 全部落在控件周界（`focus-compare-*.png` + `focus-compare-stats.json`）。

**测量踩坑（可复用）**：Chromium 未设置 outline 时 computed 报 `outline-width: 3px` + `outline-style: none`，判「有没有环」必须先看 `outlineStyle !== "none"`，只看宽度会误报双圈；`:focus-visible` 在程序化 `focus()` 下不一定命中（须键盘模态），但文本输入框在鼠标点击时也会命中——用户看到的双圈很可能就是点搜索框时出现的。

### 验收

- `verify-pluginmarket-fixes-0915.mjs` **82/82 断言**（浅深 × 1440/994 列表 + 浅深 × 作用域/新建市场弹窗，共 8 场景）。
- axe-core 4.13.0：8 场景 `color-contrast` **全 0 处**（修前去重后 4 类根因）；无横向溢出、无 console error / pageerror。
- 浅色桥接影响面（`verify-light-bridges-0915.mjs` → `light-bridge-impact.json`，**EV-07 模拟对照**：同页把三条 token 改回编辑器字面值作 before）：**静止态全量 DOM 0 项变化**（desktop-rich 585 元素 / 插件市场 143 元素）；交互态可达 5 项中 3 项按设计变化（插件行 hover 面、文本输入与作用域胶囊 hover 边框去蓝）。**副作用**：浅色选中面 `rgba(0,0,0,.14)`≈#DBDBDB → `--cc-fill-pressed #E7E9ED`，选中态变淡（与深色口径一致）。
- 未授权项保持原样（残留清单见报告，带触发语）：**F-05** 弹窗焦点管理（打开移入 / Tab 困于弹窗 / 关闭归还）、**D-04** 外壳几何 800 vs 768、**D-05** 选中语言统一、**D-03 其余字号**、**T-01b** 小字状态色角色缺失（待 codex 回写 skill）、**F-06r** 对话流外壳约 20 类控件的焦点环仍是浏览器默认蓝 `rgb(0,95,204)`（贴边单圈、无空隙，非本次的双圈问题）。

### 备注

- 未跟踪文件 `packages/webview/prototype/mockShared.ts`、`prototype/pluginMarketMock.ts` 属原型工具链，不在本次提交内。
- `--cc-*` 角色只在 `[data-host="desktop"]` 内定义，组件里消费必须带 host token 兜底（否则会连带打断 VS Code / JetBrains 宿主）。

---

## 插件市场设置页走查追加批（页头操作位 · 分段 tab · 选中段配色 · 弹窗面角色）

来源 = 设计走查对本页的追加评论（新建市场按钮位置与圆角 / 筛选改用弹窗分段形制 / 选中段配色 / 深色弹窗面是否可角色化）。四轮指示按序实施，逐轮留在工作区，本轮一次性提交。

### 第一处 · 「新建市场」移入页头右上角

- 页头改「标题块 + 右上角操作位」两列：`SettingsPluginView.tsx` 把 `h1 + p` 包进 `.settings-page-header-text`，按钮移到同层；样式只挂**视图修饰类** `.settings-plugin-header`（`display:flex; align-items:flex-start; justify-content:space-between; gap:12px`）。
- **不能挂在公共 `.settings-page-header` 上**：其余 7 个设置视图的页头是 `h1` + `p` 两个直接子元素，加 `flex` 会让标题与说明并排。泄漏模拟（MCP 服务视图）实测：临时加 `display:flex` 后标题 x=484 / 说明 x=1043 **同排**，故用修饰类把作用域锁死。
- 按钮圆角 **6px → 8px**（`.settings-plugin-new-market`），并自带 `gap: 4px`（原挂在工具条操作区容器上）；高 32px、配色、字号沿用 D-02 既有档。按钮顶边与 `h1` 顶边差 **0px**，右缘贴页头右界。
- 侧效：工具条那一行不再折行，其下内容整体**上移 9px**（筛选行 y 201 → 192、首行 263 → 254）。

### 第二处 · 筛选（全部/已安装/未安装）改用弹窗分段形制

- `.settings-plugin-filters` 由胶囊组改为**静态轨道**：`--cc-fill` 面 + `3px` 内衬 + `3px` 间距 + `8px` 圆角，整组 **32px**（= 3×2 内衬 + 26 段高，与右侧 32px 搜索框同高）。
- `.settings-plugin-chip`：高 26px、`padding: 0 12px`、圆角 6px、13px/500；hover 只提文字色（不在轨道上再叠一层填充面）。
- 与弹窗分段逐值对照：轨道面 / 圆角 / 内衬 / 间距 / 段圆角一致；弹窗分段的轨道与两段在浅深 × 1440/994 四组下**与改前逐值为同一字符串**（零回归）。
- 语义**不换** `role=tab`：这是一组筛选开关（保留 `aria-pressed`），弹窗那边本无方向键导航，换 role 会让键盘用户误以为支持 ←/→；改为补 `role="group" aria-label="插件筛选"`。

### 第三处 · 选中段配色（浅色档为白面 + 炭黑字）

- 新增一对角色（`host-desktop.css` 浅深两块）：**`--cc-bg-segment-active` / `--cc-text-segment-active`**
  - 浅色：`#FFFFFF` / `#1F2329`（白面 + 炭黑字，本组件特殊规范，与主按钮反相）
  - 深色：`#E0E3E5` / `#191C1E`（浅灰面 + 深字，即上一轮的「反白」）
  - 两档统一读作「**亮面 + 深字**」。不能用单一既有角色表达：`--cc-text-inverse` 浅色档 = `#FFFFFF`、`--cc-text-primary` 浅色档 = `#1F2329`，而深色档恰好相反，故必须成对立盏。
- 消费点两处：`.settings-plugin-chip.is-active` 与 `.settings-modal-seg-item.is-active`（同一组件，两处同值）。宿主兜底仍落 `--vscode-button-background` / `--vscode-button-foreground`，非 desktop 宿主外观不变。
- 对比度：浅色 **15.78:1**、深色 **13.28:1**（≥13:1）；浅色选中面 vs 轨道（`--cc-fill`）ΔL* **4.6**，vs 页底/弹窗体（均 `#FFFFFF`）ΔL* 0 —— 轮廓由轨道给出。**未加投影**（用户明确不需要）。
- 深色档改前/改后截图**逐像素 0 差异**（未动）；浅色差异只落在选中段矩形内（10.85% / 18.77% 像素）。

### 第四处 · 新增「模态弹窗面」角色 `--cc-bg-modal`

- 背景：深色弹窗原随 `--cc-bg-overlay`（`#232526`）。该角色是菜单 / 气泡 / 确认卡 / 面板共用的 floating 层，深色 `#232526` 是 skill `references/dark-theme.md:11` 的 **Accepted decisions**（2026-09-06 已接受），不能为弹窗改它；故另立一盏，**只喂 `.settings-modal`**。
- 定义：浅 `#FFFFFF`（与原值同 → 浅色零视觉变化）/ 深 `#181A1B`（= `--cc-bg-navigation`，即用户要的「与侧边导航同色」）。
- 消费链：`var(--cc-bg-modal, var(--cc-bg-overlay, var(--vscode-editorWidget-background, var(--vscode-dropdown-background))))`；两个弹窗（新建市场 / 选择·更换安装作用域）共用 `.settings-modal`，实测两处同值。
- 零回归：`--cc-bg-overlay` 及 5 处消费点（`.permission-mode-menu` / `.plus-menu` / `.desktop-remote-browser` / `.history-search-header` / `.confirmation-dialog-inner`）逐值未动；浅色改前/改后截图**逐像素 0 差异**；深色 `#232526 → #181A1B`。
- 分离度读数（深色，遮罩 `rgba(0,0,0,.4)` 压暗后页底 `#0E1010`）：面 vs 页底 ΔL* 5.4 → **0.0**（同色）；面 vs 压暗页底 ΔL* 10.0 → **4.6**；1px 边框 `#34393C` vs 面 ΔL\* 9.1 → **14.5**（面变暗，边框反而更清楚）。浅色同口径为 36.8，故浅色不易察觉、深色更依赖边框与遮罩。
- **未做**（用户已明确关闭阴影议题）：阴影 `0 24px 64px rgba(0,0,0,0.22)` 与遮罩 `rgba(0,0,0,0.4)` 仍是字面值，未接 `--cc-shadow-overlay` / `--cc-bg-mask`；深色面也未再抬档。

### 验收

- 探针（Playwright，DPR2，真实 DOM；「改前」用内联 style 复现旧声明，不是历史截图）：`probe-newmarket-header-0916.mjs`、`probe-plugin-seg-0916.mjs`、`probe-modal-role-0915.mjs`、`probe-modal-scope-0915.mjs`、`probe-segment-active-0915.mjs`。
- axe-core 4.13.0（装在 `/tmp/axe`，未进仓库依赖）：本视图浅深各 **0 违规、0 color-contrast**。
- `pnpm --filter wave-webview exec tsc --noEmit` exit 0；改前/改后像素 diff 逐组核过（见上）。
- 其余 7 个设置视图页头零回归（`display: block` + `H1+P` 两行，8/8）。

### 残留（未授权，保持原样，带触发语）

- **弹窗分段整组高 38px**（段高 32px、`padding: 7px 0` + `flex: 1`）与本轮筛选分段整组 32px（段高 26px）**不一致**；skill `.cc-segmented__item` 的 `min-height: 32px` 与弹窗那处一致。触发语：**「弹窗分段也对齐 32」**。
- skill 回写归属：本轮四处已整理为交接单 **W-15 ~ W-21**（`skill-backfill-0915-for-codex.md`），其余由 codex 执行；其中 W-16 是**覆盖** skill 现有条款 `desktop-theme-bridge.md:29`（该行要求选中胶囊浅深两档都用反白，与本轮浅色档相反）。
- 确认卡族口径（本体 `--cc-bg-overlay` / 外容器 `--vscode-panel-background` → `#111314`）未动，仅记录。

## 0915 追加批 · 第五处：「选择文件夹」改为「虚线 + 加号」块（已随本批推送）

来源 = 设计走查对本页的追加评论（`button.settings-row-btn.settings-modal-block-btn`「选择文件夹」）：「选择文件夹前面加个加号的图标，字号 14px，居中显示，描边用虚线，这块区域高度 32px，和表单保持一致」。

- **文件**：`SettingsPluginView.tsx`（按钮内前置 `<SettingsAddIcon />`）、`SettingsPage.css`（`.settings-modal-block-btn`）。
- **实现**（基准 `.settings-row-btn` = 12px / 28px / 实线 / 左对齐 → 本档抬到表单档）：
  - `height: 40px → 32px`（原 `min-height: 40px` 移除）：与同档 `.settings-text-input` 的 `min-height: 32px` 同高，故「本地路径 / 远程仓库」两个 tab 的行高一致。
  - `font-size: 12px → 14px`；`justify-content: center`；`border-style: dashed`；`gap: 4px`（图标与文字间距，沿用页头「新建市场」口径）。
  - 图标沿用页头「新建市场」用的同一个 Figma 加号 `SettingsAddIcon`（16×16、`viewBox 0 0 32 32`、`fill: currentColor` → 随按钮文字色），不新增图标资源。
- **实测**（`probe-pickfolder-btn-0915.mjs`，DPR2 / 1440，浅深两档，after = 现网 DOM / before = 内联 style 复现旧声明）：
  - 高 **40 → 32**、字号 **12px → 14px**、边框 **solid → dashed**、图标 无 → **16×16**（浅色 `rgb(32,32,32)` / 深色 `rgb(229,231,232)`，= 按钮文字色）。
  - 居中：**图标 + 文字整组**在 540px 宽按钮里的左/右内衬均 **224px**（对称）；文字盒左 244 / 右 224 —— 差值 20px **恰好等于图标 16px + 间距 4px**，即整组居中，非文字偏心。
  - 行高 40 → **32**，与同档输入框（32px）一致；圆角保持 **8px**（评论点名的是高度，未动圆角）。
  - 两档均无横向溢出、无 console/pageerror；`pnpm --filter wave-webview exec tsc --noEmit` exit 0。
- **未做 / 待她点名**：
  - 虚线颜色仍取按钮口径 `--vscode-panel-border`（浅 `#E4E7ED` = quiet line），比同档输入框的 `--cc-border`（浅 `#DCDFE6` = 强边界）淡一档；评论只说「描边用虚线」故未改色。触发语：**「虚线描边用输入框档」**。
  - 圆角 8px（按钮口径）vs 表单 6px；评论只点名高度，未动。触发语：**「虚线块圆角也跟表单」**。
  - 14px 字重仍是 400（`.settings-row-btn` 无 `font-weight`）；页头「新建市场」是 500。触发语：**「选择文件夹也用 500」**。
- 截图：`走查/0915-插件市场/pickfolder-{before,after}-{light,dark}.png`；读数 JSON `pickfolder-btn-0915.json`。

## 0915 追加批 · 第六处：公共 tab 组件字号 13px → 14px（已随本批推送）

来源 = 设计走查对本页的追加评论（`button.settings-tab`「wave-plugins-official 10」）：「tab 里面的字号也应该是 14px」。

- **文件**：`SettingsPage.css` `.settings-tab`（**公共 tab 组件**，非插件市场专有）。
- **改动**：`font-size: 13px → 14px`；`line-height` 保持 22px（14/22 = 契约正文档档）。
- **作用范围（按组件规格改，非单视图覆盖）**：`.settings-tab` 由共享组件 `SettingsTabs`（`SettingsManageComponents.tsx:26`）与两处内联 tablist 共用 → 共 **6 条 tab 条**受影响：插件市场 / MCP / 技能 / 钩子（均走 `SettingsTabs`）+ 「AGENTS.md 规则范围」（`SettingsPage.tsx:763`）+ 「来源范围」（`SettingsManageComponents.tsx:33`）。若只想改插件市场这一处，加作用域覆盖即可（触发语：**「tab 字号只改插件市场」**）。
- **实测**（`probe-tabfont-0915.mjs`，浅深 × 1440/994 四组，after = 现网 DOM / before = 内联 style 复现 13px）：
  - 段盒**高度 46px 未变**、tab 条**高 59px 未变**、工具条顶 **192px 未变**（下方内容零位移）。
  - 宽度按文字重排：`wave-plugins-official` 152 → **161**、`wave-community` 126 → **134**、`acme-internal-tools-marketplace` 214 → **229**（三条合计 +31px）。
  - **计数角标不受牵连**：仍是 **12px / 16px**（F-07 已批准的紧凑元信息下限）。触发语：**「tab 里计数也用 14」**。
  - 激活下划线仍是 **3px** 贴底（浅色 `rgb(32,32,32)` / 深色 `rgb(229,231,232)`）；横向溢出 0（1440 与 994 两档都不换行、无裁切）。
- 截图：`走查/0915-插件市场/tabfont-after-{light,dark}-{1440,994}.png`；读数 JSON `tabfont-0915.json`。

## 0915 追加批 · 第七处：作用域胶囊（`.settings-scope-pill`）字号/字色/宽度（已随本批推送）

来源 = 设计走查对本页的追加评论（`button.settings-scope-pill`「用户」）：「里面字号应该是 14px，字体颜色应该是最高级的，宽度和后面的按钮保持一致吧，可以按钮窄一点，看看按钮现在里面最多的文本是多少，不抖动的情况下保持宽度一致」。

- **文件**：`SettingsPage.css` `.settings-scope-pill`（已安装插件行里显示当前作用域、点击更换的那个胶囊）。
- **改动**：`font-size: 12px → 14px`；字色 `--vscode-descriptionForeground → var(--cc-text-primary, var(--vscode-foreground))`（浅 `#1F2329` / 深 `#E5E7E8`，即最高级正文档；桌面宿主下 `--vscode-foreground` 本就 = `--cc-text-primary`，故 hover 不再变色）；`min-width: 88px` + `justify-content: center`（与同行 `.settings-plugin-act` 同宽同机制）。
- **宽度取值依据（实测数据，非估计）**：
  - 同行 `.settings-plugin-act`（安装 / 更新 / 移除 / ✓ 已安装）**全部恒为 88px**（`min-width: 88px`；最长文案「✓ 已安装」13px/600 = 52.34px + 内衬 28 = 80.34 < 88，故均按 88 收敛）。
  - 胶囊侧内容宽 = 文字 26.84（四种作用域文案「用户/项目/本地/未知」均为 2 字，14px/500 实测同宽）+ gap 6 + chevron 16 + 内衬 24 = **72.84px** → 用 `min-width: 88px` 收敛到 **88px**，与右侧按钮**逐像素同宽**，四种文案下宽度恒定（**无抖动**），余量 15.16px。
  - 用共用 `min-width` 而非写死 `width`：文案将来变长时两侧同步增长，仍对齐。
- **实测**（`verify-scopepill-0915.mjs`，浅深两档，after = 现网 DOM / before = 内联 style 复现改前）：宽度 **72 → 88**、字号 **12 → 14px**、字色 `rgb(96,96,96)` → 浅 `rgb(31,35,41)` / 深 `rgb(229,231,232)`、居中空隙 13/13 → **19/19**（`文字 26.84 + gap 6 + chevron 16` 整组居中）；`.settings-plugin-act` 保持 88px/13px **未动**。
- **侧效（已量化）**：有胶囊行的操作列 `168 → 184px`，信息列 `510 → 494px`；**10 行描述仍全部 1 行**（换行数不变）、行高合计 `656 → 656`、横向溢出 0；**无胶囊行改前/改后截图逐像素 0 差异**（227,136 px 全等，作用范围仅此一个控件）。
- **候选（未做，带触发语）**：若这组还要更窄，胶囊与 `.settings-plugin-act` 可一起收到 **81px**（= 最长文案 80.34 + 余量 1，胶囊内容 72.84 也放得下）。触发语：**「行按钮组收到 81」**。
- 截图：`走查/0915-插件市场/scopepill-{before,after}-{light,dark}-row{0,1}.png`、`scopepill-nopill-{light,dark}-{before,after}.png`；读数 `scopepill-0915.json`、`scopepill-measure-{light,dark}.json`。

## 0915 追加批 · 第八处：三批字级修正（正文 13 → 14 / 控件 13 → 14 / 弹层列表 13 → 14）（已随本批推送）

来源 = 设计师先问「检查一下 skill 的规范，什么时候用 13 号字，现在界面中我感觉把 13 号字当正文来用了」（审计，不改代码），审计结论汇报后她连发三条授权：**「正文类 13 改 14」→「控件文字也改 14」→「弹层列表也一起」**。三条按序实施，范围严格限定在她点名的三类。

### 契约依据（逐字回源，回答「13px 什么时候用」）

| 依据                                          | 逐字                                                                                            | 结论                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| `references/conversation-typography.md:30`    | 「用户正文、AI 段落、列表正文、引用正文、表格单元格 \| 14 / 22 \| 400 \| 沿用正文约定」         | 正文 = **14/22**                        |
| `references/conversation-typography.md:37`    | 「时间、数量、依赖等辅助信息 \| 12 / 20 \| 400 \| …**必要操作说明不降为辅助文字**」             | 紧凑元信息 = **12/20**；说明类不得降级  |
| `references/conversation-typography.md:38`    | 「行内代码、命令、代码块、diff、文件预览、原始日志 \| 13 / 20 \| 400 \| CC 本轮采用的代码角色」 | **13px 的唯一正当用途 = 代码/等宽角色** |
| `references/conversation-typography.md:39`    | 「面向用户的错误解释 \| 14 / 22 \| 400 \| 正文角色」                                            | 错误解释也是正文                        |
| `references/conversation-typography.md:35`    | 「H4 / H5 / H6 \| 14 / 22 \| 600 \| 候选；**不小于正文**」                                      | 没有比正文更小的标题层级                |
| `references/design-system.md:66-67`           | 「Body text defaults to `14px`」「Compact metadata may use `12px`」                             | UI 正文也只有 14 / 12 两级              |
| `theme/element-plus.css:50` + `layout.css:19` | `--el-font-size-base: var(--cc-font-size-md)`                                                   | 控件基线字号 = 14px                     |
| `tokens/tokens.css`                           | `--cc-font-size-xs: 12 / sm: 13 / md: 14`，另设 `--cc-code-font-size: 13px`                     | 13px 在 token 层是给代码角色的档位      |

**审计结论**：契约里 **不存在「13px 的 UI 层级」**——正文 14、紧凑元信息 12、代码角色 13。她的判断成立：界面把 13px 当正文/控件文字用，属历史漂移而非设计决定。13px 的合法保留项只有代码/等宽角色（本页无代码角色）。

### 审计口径（有效集，不是原始计数）

- 组件 CSS 中声明 `13px` 的类共 **51 个**；其中 **11 个**已被桌面语义层 `host-desktop.css:1936` 覆盖为 14px（`.rewind-popup-item`、`.model-popup-item`、`.history-item-prompt`、`.slash-command-name`、`.session-list-item-title` 等），**故「弹层列表也一起」实际只剩 `.file-suggestion-dropdown` 一处漏网**（其子项靠继承取字号，桌面层未覆盖）。
- 证据等级：`.file-suggestion-dropdown` 一组为 **B**（桌面层覆盖清单 + 计算值抽查，非全量视觉回归）；其余为 **A**（计算值 + 几何实测）。

### 批 1 · 正文类 13 → 14/22（其中描述类经追加评论再收到辅助档，见本节末「之一」）

| 类                            | 文件               | 改前 → 改后                                                  |
| ----------------------------- | ------------------ | ------------------------------------------------------------ |
| `.settings-plugin-desc`       | `SettingsPage.css` | `13px`/1.5（19.5）→ 14/22 → **追加评论后定档 `12px`/`20px`** |
| `.settings-scope-option-desc` | `SettingsPage.css` | 同上（**仍 14/22**，见残留：语义同为「描述」，待她裁决）     |
| `.settings-modal-hint`        | `SettingsPage.css` | `13px`/1.5 → `14px`/`22px`（必要操作说明，契约不降级）       |
| `.btw-panel-answer`           | `BtwPanel.css`     | `13px`/1.5 → `14px`/`22px`                                   |

#### 之一 · 追加评论：插件行描述归辅助档 `12/20`（已随本批推送）

来源 = 设计师对 `div.settings-plugin-desc`（「集成 Git 工作流：…」）的评论：**「这里属于描述，应该都是 12px」**。

- **依据**：`conversation-typography.md:37`「时间、数量、依赖等辅助信息 \| 12 / 20」+ `design-system.md:67`「Compact metadata may use `12px`」——描述归**辅助**而非正文（正文 14/22 一条被本评论收窄适用范围）。同时 `:37`「必要操作说明不降为辅助文字」→ 同组 `.settings-modal-hint` **保持 14/22 不动**。
- **改动**：`.settings-plugin-desc` `font-size: 14px → 12px`、`line-height: 22px → 20px`。
- **三态实测**（`verify-desc12-0915.mjs`，浅深 × 1440/994 四档，Range 数真实行盒）：

| 档位                 | 字号/行高       | 10 行描述换行数（1440 / 994） | 单行行高    | 内容总高（1440 / 994） |
| -------------------- | --------------- | ----------------------------- | ----------- | ---------------------- |
| 原始                 | 13px / 19.5px   | 1111111111 / 1111111**2**11   | 65.5 / 64.5 | 1013 / 1033            |
| 上一版               | 14px / 22px     | 1**2**11111**22**1 / 同上     | 68 / 67     | 1104 / 1104            |
| **现状（本评论后）** | **12px / 20px** | **全 1 行** / **全 1 行**     | **66 / 65** | **1018 / 1018**        |

- **结论**：12px 后 **10 行描述在 1440 与 994 全部单行**（994 下原本会换行的 Monorepo Release Orchestrator 也回到单行，行高 `85 → 66`），前述「Code Reviewer 末行 1 个汉字」的孤字问题**随之消解**；横向溢出 0、console/pageerror 0、浅深一致。列表比原始 13px 状态在 994 下还更紧凑（内容总高 `1033 → 1018`）。
- 截图：`走查/0915-插件市场/fontfix3-{light,dark}-{1440,994}-list-{12,13,14}.png`；读数 `fontfix3-desc-0915.json`。

### 批 2 · 控件与标题类 13 → 14（行高保持原值）

`SettingsPage.css` 共 **19 处**（对 HEAD 逐规则比对：本文件 `13px → 14px` 的规则共 22 条，其中 3 条属批 1、1 条 `.settings-tab` 属第六处，余 18 条 + 原无声明（继承 13px）的 `.settings-back` = 19）：`.settings-back`、`.settings-nav-group h2`、`.settings-nav-item`、`.settings-section-heading h2`、`.settings-row-copy h3`、`.settings-number-control`、`.settings-select`、`.settings-number-input`、`.settings-text-input`、`.settings-save-btn`、`.project-item`、`.settings-textarea`、`.memory-turns`、`.settings-readonly-value`、`.settings-placeholder`、`.settings-project-card-header`、`.settings-plugin-chip`、`.settings-plugin-act`、`.settings-modal-seg-item`。依据 = `element-plus.css:50` 控件基线 14px + 标题不得小于正文（`conversation-typography.md:35`）。行高沿用各自原值（如 `.settings-nav-item` / `.project-item` / `.settings-textarea` 保持 22px）。

- **几何护栏**：`.settings-modal-seg-item` 若沿用 `line-height: normal`，段高会 `32 → 34`、整组 `38 → 40`（normal 行盒随字号变大）。已把行盒钉在 `18px`，**只动字号不动几何**（实测组高 38 / 段高 32 与改前逐值相同）。若将来收「弹窗分段也对齐 32」，需同时改 `padding`（`26 = 18 行盒 + 上下各 4px`）。

### 批 3 · 弹层列表 13 → 14

`.file-suggestion-dropdown`（`FileSuggestionDropdown.css`，`13px → 14px`）：子项 `.suggestion-item` / `.suggestion-name` 靠继承取字号，一改即全列表生效；该容器是桌面层弹层字号清单里的漏网一处（同批 `.model-popup-item` / `.rewind-popup-item` / `.history-item-prompt` 已由 `host-desktop.css` 置 14px）。

### 实测（浅深 × 1440/994；after = 现网 DOM，before = 注入改前 `!important` 覆盖同帧复现）

- **字号**：`.settings-plugin-desc` 13 → 14 → **12（追加评论定档，见「之一」）**、`.settings-plugin-act` 13 → 14、`.settings-plugin-chip` 13 → 14、`.settings-save-btn` 13 → 14、`.settings-nav-item` 13 → 14、`.settings-text-input` 13 → 14、`.settings-modal-seg-item` 13 → 14（浅深四档一致）。
- **控件高全部未动**：`.settings-plugin-act` 28、`.settings-plugin-chip` 26、`.settings-save-btn` 32、`.settings-tab` 46、`.settings-back` 30、`.settings-nav-item` 30、`.settings-text-input` 32、`.settings-scope-pill` 28（改前 = 改后）。
- **弹窗分段**：`13px/18px 组高 38 段高 32 → 14px/18px 组高 38 段高 32`（护栏生效，几何零变化）。
- **BtwPanel**：答复字号 `13px/19.5px → 14px/22px`，答复块高 `36 → 38`，**面板高 77 → 77 不变**。
- **@ 文件建议弹层**：容器 `13px → 14px`、`.suggestion-name` `13px → 14px`；**弹层 `302×302` 不变、item `300×57`（末项 56）不变、滚动内容 `341` 不变、首屏完整可见条数 `5` 不变**（名字行盒 16 → 17 落在 item 内部弹性空间，不外溢）。
- **插件列表（最终 12/20 档）**：单行描述行高 `65.5/64.5 → 66/65`；**10 行全部单行**；内容总高 `1013（1440）/ 1033（994）→ 1018 / 1018`；横向溢出 `0 → 0`；浅深一致。（14px 中间档的对照读数：单行 68/67、两行 90、内容总高 1104。）
- 溢出与报错：横向溢出 0、console/pageerror **0 条**、`tsc --noEmit` 通过。

### 侧效与换行归因（描述 14px 档下的代价，已量化；**已由「之一」的 12px 定档消解**）

按 canvas 逐行量文本所需宽度（`probe-descwrap-0915.mjs`）与 DOM 行盒实测（`verify-fontfix-0915b.mjs`）：

| 行                            | 1440 可用宽 | 14px 单行所需 | 结果                                         |
| ----------------------------- | ----------- | ------------- | -------------------------------------------- |
| Code Reviewer                 | 494         | 486.5         | **换行**，且第 2 行只剩 1 个字「论」（孤字） |
| Monorepo Release Orchestrator | 494         | 517.7         | 换行（994 下改前本就两行）                   |
| Performance Profiler…         | 590         | 576.7         | 换行（临界）                                 |

→ 10 行里 1440 有 3 行、994 有 3 行变两行；**换行由字号引起（非行高）**：13px 时所需宽度均小于可用宽，14px 时临界两行越界。这是「正文对齐契约」与「列表密度」之间的真实取舍，当时单列为残留项待裁决、未自行改动列宽；**随后由她的追加评论「这里属于描述，应该都是 12px」定档 12/20 收口，换行与孤字问题随之消解**（见本节「之一」）。

### 残留（未授权，保持原样，带触发语）

- **描述档位的同组两处**（本评论只点名了插件行 `.settings-plugin-desc`）：`.settings-scope-option-desc`（作用域弹窗里的描述文案，语义同为「描述」，现 14/22，触发语 **「作用域描述也 12」**）；`.settings-modal-hint`（现 14/22，契约 `conversation-typography.md:37` 明确「必要操作说明不降为辅助文字」，**建议保留 14**，触发语「弹窗说明也降 12」）。
- **描述换行 / 孤字（14px 档下的问题）**：已由 12px 定档消解；若将来描述回 14，会重新出现（1440 三行两行化、Code Reviewer 末行 1 个汉字）。触发语：**「描述回到 14」**。
- **其余 13px 的 UI 类**（未在本轮点名范围）：`.btw-panel-header`、`.btw-panel-loading`、`.tool-block`、`.toast-action`、`.account-card-login`、`.confirm-dialog-btn`、`.confirmation-btn`、`.feedback-textarea`、`.desktop-panel-empty-sub`、`.desktop-session-empty`、`.error-message`、`.mermaid-empty`、`.configuration-field`、`.configuration-textarea`、`.radio-label`、`.mcp-server-name` 等（合计约 40 个类，多数不在插件市场面）。触发语：**「13px 只留代码角色」**。
- **低于 12px 的辅助文字**：`.suggestion-path` = `11px`（本批新发现，低于契约辅助下限 12/20；桌面层未覆盖）。触发语：**「建议弹层路径 11 改 12」**。
- **`.settings-modal-note` = 12px** 但语义是「必要操作说明」，契约 `conversation-typography.md:37` 明确「必要操作说明不降为辅助文字」→ 是否升 14 待裁决。触发语：**「弹窗说明也改 14」**。
- 弹窗分段整组高度（38 → 32）与触发语「弹窗分段也对齐 32」见批 2 护栏说明。

### 验证脚本与证据

- 脚本：`verify-fontfix-0915.mjs`（v1）、`verify-fontfix-0915b.mjs`（v2，Range 数真实行盒 + 逐行归因）、`probe-descwrap-0915.mjs`（换行临界）、`probe-filesuggest-0915.mjs`（弹层小数位几何）、`shots-fontfix-0915.mjs`（32 张 before/after）。
- 读数：`走查/0915-插件市场/fontfix-v2-0915.json`、`fontfix-0915.json`。
- 截图（32 张，`走查/0915-插件市场/fontfix2-*`）：`{light,dark}-{1440,994}` × `{list,modal,btw,filesuggest}-{before,after}.png`。
- **工具链文件（不推）**：`packages/webview/prototype/mockShared.ts` 的 `requestFileSuggestions` 补 `relativePath` / `icon` 字段——原 mock 缺字段会让 `FileSuggestionDropdown` 抛 `reading 'length'` 被 `PreviewBoundary` 兜住、弹层无法绘制（还原真实 host 回包字段，仅用于取证）。

## 0915 审计记录（无代码改动）· 新建市场弹窗「添加」按钮样式合规检查

来源 = 设计师评论（`div.settings-modal-row` 内「添加」，即 `button.settings-save-btn`，远程仓库档）：「检查添加按钮样式是否符合规范」。**仅审计，工作区未因此新增改动**；页 `CC02/审计-添加按钮样式-0915.html`，Artifact `…/artifact/qa0czyodfz`。

12 项检查结果 = **8 通过 / 1 不一致 / 2 不通过 / 1 提示**：

- **不通过（高）· 按钮文字折行且溢出按钮盒**：内衬 `4px 16px` → 内容可用 **24.4px**，「添加」14px/500 需 **28px** → 折 2 行，两行行盒总高 **36px** > 按钮高 **32px**（`scrollHeight 36 / clientHeight 32`），上下各溢出 2px；空值 / 短值 / 完整 Git 地址三种状态 × 浅深两档全部复现。**归因 = 历史缺陷**：注入 13px 复测同样折行（内容可用 22.8 < 文字需 26）。根因 = `.settings-text-input { width: 100% }` 先占满 540px 行宽，`.settings-save-btn` 为 `flex: 0 1 auto` + `white-space: normal` + `min-width: auto`（中文 min-content = 1 字）→ 被压到 56.4px，小于固有宽 60px。候选：**B1** `.settings-modal-row .settings-save-btn { flex: 0 0 auto; white-space: nowrap; }`（推荐，输入框让出 3.6px，行总宽与两档行高不变）/ B2 `min-width: 60px` / B3 全局改（范围大）。
- **不通过（低）· 缺按压态**：按下时底色仍 = hover 色（浅 `#34383F` / 深 `#F0F2F3`），未接 `--cc-action-primary-active`（浅 `#111318` / 深 `#C7CCCF`，`dark-theme.md:30`）。
- **不一致（中）· 圆角口径**：实测「添加」**6px**（= Element Plus 按钮基线 `--el-border-radius-base: var(--cc-radius-sm)`，`element-plus.css:44`；codechat 动作按钮 r6，见 `host-desktop.css:2070` 注释）vs 同弹窗「选择文件夹」**8px** vs 同一个 `.settings-save-btn` class 的页头「新建市场」**8px**（由 `.settings-plugin-new-market` 覆盖）→ 同一弹窗内两种口径并存，属口径选择而非硬违规，待裁决。
- **通过**：字号 14px/500（本轮已由 13 修正）；高 32 = 同排输入框 32（`vue-element-plus.md:55`）；浅色主色底 `#1F2329` + 白字 **15.78:1**；深色浅灰底 `#E0E3E5` + 深字 `#191C1E` **13.28:1**（已批准 dark 映射，`host-desktop.css:168-170`）；hover 只加深底色（11.77:1 / 15.25:1）；禁用态 `disabled={!input.trim()}` + `opacity .6` + `not-allowed`，合成后字/底 **4.25:1**（浅）/ **5.56:1**（深）可辨；焦点环 `2px solid` + `offset 2px`（环/画布 15.78:1 / 7.02:1；深色环色 `#A0A5A8` = wave 已批准值，与 skill `desktop-colors.css:64` 映射不同，属已批准差异）；键盘自输入框 1 次 Tab 可达；Enter 提交。
- **提示**：6px 为字面量（wave 仓库未见 `--cc-radius-sm` 变量声明）。
- **触发语**：「添加按钮不要折行」「按 B1 修」「按 B2 修」「添加按钮补按压态」「添加按钮圆角用 8」「按钮圆角统一回 6」。
- 证据：脚本 `CC02/audit-addbtn-{0915,states-0915,wrap-0915,wrap13-0915}.mjs`；读数 `走查/0915-插件市场/audit-addbtn-*.json`；截图 `audit-addbtn-{light,dark}-{disabled,enabled,focus}.png` 与行级 `audit-addbtn-{light,dark}-row-{empty,short,long}.png`（DSF3，12 张）。

## 0915 追加批 · 第十处：新建市场弹窗「添加」按钮四项修正（已随本批推送）

授权 = 设计师对上述审计记录的四条指示，逐条对应审计结论，**范围严格等于这四条**：
**「添加按钮不要折行」**（修不通过 1）、**「按 B1 修」**（选定候选 B1）、**「添加按钮补按压态」**（修不通过 2）、**「添加按钮圆角用 8」**（裁决口径不一致项，取 8）。

### 依据（逐字回源，与前节审计同源）

- 折行不该发生：`conversation-typography.md:37`「时间、数量、依赖等辅助信息 \| 12 / 20」与控件基线 `element-plus.css:50`（`--el-font-size-base = --cc-font-size-md` = 14px）都要求 14px 的「添加」在其固有宽内单行可读；按钮高 32（`vue-element-plus.md:55` 设置页控件 32px）为既定档位，**文字溢出按钮盒**属几何违规而非风格取舍。
- 按压态：`dark-theme.md:30`「pointer-down → `--cc-action-primary-active`」；`tokens/tokens.css:20` 浅色 active = `#111318`。
- 圆角 8：`design-system.md:32/169` 内容面板 / 设置页返回行取 8px + `tokens/tokens.css:119-123`（`--cc-radius-md` = 8px）；同一弹窗内「选择文件夹」已是 8px，取 8 使弹窗内口径归一。

### 改动（3 处，均在 `SettingsPage.css`）

| #   | 规则                                       | 改动                                                         | 对应指示                  |
| --- | ------------------------------------------ | ------------------------------------------------------------ | ------------------------- |
| ①   | `.settings-modal-row .settings-save-btn`   | 新增：`flex: 0 0 auto; white-space: nowrap;`                 | 「不要折行」+「按 B1 修」 |
| ②   | `.settings-modal-row .settings-save-btn`   | 新增：`border-radius: var(--cc-radius-md, 8px)`              | 「圆角用 8」              |
| ③   | `.settings-save-btn:active:not(:disabled)` | 新增：`background: var(--cc-action-primary-active, #111318)` | 「补按压态」              |

- ①的机理：同级 `.settings-text-input { width: 100% }` 先占满 540px 行宽，按钮 `flex: 0 1 auto` 被压到 56.4px（< 固有宽 60px），中文 `min-content` = 1 字 → 「添加」折 2 行、行盒总高 36px > 32px 按钮盒。钉住固有宽后输入框让出 3.6px（`473.6 → 470`），行总宽仍 540。
- ③的**坑（已在代码注释中写明）**：深色档已定义 `--cc-action-primary-active`（`host-desktop.css:155` `#c7cccf`），**浅色档没有定义**（浅色块只有 primary / primary-hover）。首版 fallback 写成 `var(--cc-action-primary-active, var(--vscode-button-hoverBackground))`，实测浅色按压仍 = hover `#34383F` → 改为**字面量 `#111318`**（= skill `tokens.css:20` 浅色 active 值）。浅色缺 token 一事单列为残留／回写候选。
- ③的作用域是**整个 `.settings-save-btn` 类**（含全局设置 / MCP / 钩子 / 个性化的「保存」），非仅弹窗内那一颗；如只需弹窗内一颗，触发语见下。

### 实测（`verify-addbtn-fix-0915.mjs`，浅深 × {空值, 完整地址}；before = 同帧注入改前 `!important` 覆盖）

| 指标                      | 改前                                                     | 改后                                                              |
| ------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| 按钮盒                    | 56.4 × 32                                                | **60 × 32**                                                       |
| 内容可用宽 / 「添加」所需 | 24.4 / 28                                                | **28 / 28**                                                       |
| 行数                      | **2 行**（竖排「添」「加」）                             | **1 行**                                                          |
| 行盒总高 / 溢出           | 36 / 溢出 2px 每侧                                       | **16 / 0**（`scrollHeight 32 = clientHeight 32`）                 |
| 圆角                      | 6px                                                      | **8px**                                                           |
| `flex` / `white-space`    | `0 1 auto` / `normal`                                    | `0 0 auto` / `nowrap`                                             |
| 输入框宽                  | 473.6                                                    | **470**（让出 3.6，为按钮固有宽让位）                             |
| 行盒总宽 × 高             | 540 × 32                                                 | **540 × 32（不变）**                                              |
| 弹窗盒                    | 590 × 227.2                                              | **590 × 227.2（不变）**                                           |
| 按压态底色                | 浅 `#34383F`（= hover，无反馈）/ 深 `#F0F2F3`（= hover） | **浅 `#111318`（18.58:1）/ 深 `#C7CCCF`（10.57:1）**              |
| 禁用态按压                | 无变化                                                   | **无变化**（`:not(:disabled)` 生效：浅 `#1F2329` / 深 `#E0E3E5`） |
| 横向溢出 / console 报错   | 0 / 0                                                    | **0 / 0**                                                         |

- **未越界核验**：同页其余 `.settings-save-btn` 逐 tab 实测仍为 `6px` / `flex 0 1 auto` / `white-space normal`（全局设置 `60×32`、个性化 `130×32` + `60×32`、MCP 服务 `189×32`、钩子 `108×32`）——① 只作用于 `.settings-modal-row` 内，未波及别处；页头「新建市场」仍 `108×32` / `r8px`（其 8px 来自 `.settings-plugin-new-market`，与本批无关）。
- 截图（12 张，`走查/0915-插件市场/`）：`fix-addbtn-{light,dark}-row-{empty,long}-{before,after,pressed}.png`；读数 `fix-addbtn-0915.json`。
- 弹窗为定宽 590，行宽 540 与视口无关，故本批未重复 994 档（折行判定不受视口影响）。

### 残留（未授权，保持原样，带触发语）

- **其余「保存」按钮圆角**：全局设置 / 个性化 / MCP 服务 / 钩子的 `.settings-save-btn` 仍是 6px（= Element Plus 按钮基线，本批只按指示改了弹窗行内那颗）。触发语 **「保存按钮圆角也用 8」**。
- **浅色档缺 `--cc-action-primary-active`**：`host-desktop.css` 浅色块未定义该 token，现用字面量 `#111318`（= skill `tokens.css:20` 的浅色 active 值）；若要消字面量，需在浅色块补 token。触发语 **「补浅色 active token」**（建议回写 skill：wave 浅色缺 pointer-down 档，与 `dark-theme.md:30` 的声明不对称）。
- **按压态作用域**：现覆盖整个 `.settings-save-btn` 类；如只想保留弹窗内一颗，「弹窗内按压态」改为 `.settings-modal-row .settings-save-btn:active` 即可。触发语 **「按压态只留弹窗那颗」**。
- 前节（第八处 / 审计记录）的其它残留项与触发语不变。
- 验证脚本：`CC02/verify-addbtn-fix-0915.mjs`；辅助探针 `/tmp/probe-other-save-0915.mjs`（逐 tab 读其余保存按钮，证明未越界）。

## 0915 追加批 · 第十一处：弹窗底部按钮组（卸载 / 取消 / 保存）层级统一（已随本批推送）

来源 = 设计师对 `div.settings-modal-actions`（作用域弹窗底部的「卸载 取消 保存」）的评论：**「弹窗中的按钮层级应该保持一致，卸载按钮放在最左边，按钮圆角统一 8px，字号 14px」**。四条要求逐条落实：

| 指示             | 改前                                                                                                                                                   | 改后                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 按钮层级保持一致 | 同一行三种口径：卸载/取消 = `.settings-row-btn` 列表行档（**12px / 28px / r8 描边**），保存 = `.settings-save-btn` 控件档（**14px / 32px / r6 实心**） | 三者同一条控件基线：**14px / 32px / r8**，层级只靠填充区分（危险描边 / 次要描边 / 主色实心） |
| 卸载放最左边     | 卸载在右对齐簇的最左端（`xInBar 367`）                                                                                                                 | **`xInBar 0`**，与上方作用域选项卡左缘对齐（弹窗内 `xInDialog 25` = 选项卡 25）              |
| 圆角统一 8px     | 卸载/取消 8px、保存 6px                                                                                                                                | **三者 8px**                                                                                 |
| 字号 14px        | 卸载/取消 12px、保存 14px                                                                                                                              | **三者 14px**                                                                                |

- **依据**：32px = `references/vue-element-plus.md:55` 设置页控件 32px（同弹窗「选择文件夹」「添加」已是 32px，故三档一致）；14px = `theme/element-plus.css:50` 控件基线 `--el-font-size-base` = `--cc-font-size-md`；8px = `tokens/tokens.css` `--cc-radius-md`（并与上一轮「添加按钮圆角用 8」同口径，使弹窗内四个按钮圆角一致）。**层级一致性也要求同盒高**：28px 的描边按钮紧挨 32px 的实心按钮正是「层级不一致」的可见来源，故一并收到 32px。
- **内衬**同取 `0 16px`（与主按钮一致），使 2 字标签的三个按钮盒宽相同（`62.6×32`（描边含 1px 边框）/ `60×32`（实心无边框）），差异只落在底色与描边上。
- **实施**（`SettingsPage.css`，作用域仅 `.settings-modal-actions`）：

```css
.settings-modal-actions .settings-row-btn {
  height: 32px;
  padding: 0 16px;
  font-size: 14px;
  border-radius: var(--cc-radius-md, 8px);
}
.settings-modal-actions .settings-row-btn-danger {
  margin-right: auto;
} /* 卸载钉最左 */
.settings-modal-actions .settings-save-btn {
  border-radius: var(--cc-radius-md, 8px);
}
```

### 实测（`verify-modalactions-fix-0915.mjs`，浅深两档；before = 同帧注入改前声明 `!important` 复现）

| 元素               | 改前                                                     | 改后                                                                  |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------------------------- |
| 卸载（危险描边）   | 46.5×28 / 12px / r8 / `xInBar 367`                       | **62.6×32 / 14px / r8 / `xInBar 0`（对齐选项卡左缘）**                |
| 取消（次要描边）   | 46.5×28 / 12px / r8 / 右距 95                            | **62.6×32 / 14px / r8 / 右距 95（不变）**                             |
| 保存（主色实心）   | 60×32 / 14px / **r6** / 右距 25                          | **60×32 / 14px / r8 / 右距 25（不变）**                               |
| 按钮组 / 弹窗盒    | 540×32 / 590×400                                         | **540×32 / 590×400（不变）**                                          |
| 未安装档（无卸载） | 取消 46.5×28 + 安装 60×32                                | 取消 62.6×32 + 安装 60×32，**右对齐位置不变**（`xInBar 407.4 / 480`） |
| 保存 hover / 按压  | `#34383F` / `#111318`（浅）、`#F0F2F3` / `#C7CCCF`（深） | **逐值不变**（上一轮的按压态未被本批破坏）                            |
| 报错               | —                                                        | console/pageerror **0 条**（浅深）                                    |

- **未越界核验**：同页其它 `.settings-row-btn` 仍是列表行档（「更新市场」「移除市场」= `12px / 71×28 / padding 0 10px`）；其它页面「保存」按钮仍是 `14px/32/r6`（全局设置 `60×32`、MCP 服务 `189×32`、钩子 `108×32`）——本批只作用于 `.settings-modal-actions` 内。
- 截图（6 张）：`fix-modalactions-{light,dark}-{before,after}.png`、`fix-modalactions-{light,dark}-install-mode.png`；读数 `fix-modalactions-0915.json`。

### 残留（未授权，保持原样，带触发语）

- **确认弹窗（移除市场 / 删除 worktree 共用的 `ConfirmDialog`）按钮仍是 `28px / r6 / 13px / min-width 64`**（`ConfirmDialog.css:68-81`），与本轮确立的「弹窗按钮 = 32/14/8」不一致。它同时被对话流外壳的删除 worktree 复用，改动面跨出插件市场页，故未动。触发语 **「确认弹窗按钮也统一 32/14/8」**。
- **卸载是否改用柔和危险底**（现为危险描边 + 文字色，hover 走 `--cc-fill-hover`）未点名，未动。触发语 **「卸载改柔和危险底」**。
- 上一节（第十处）的三条残留与触发语不变；另「弹窗次要按钮内衬回到 10px」触发语 **「弹窗次要按钮内衬用 10」**（本批为对齐主按钮取了 16px）。
- 验证脚本：`CC02/verify-modalactions-fix-0915.mjs`；现状审计探针 `CC02/audit-modalactions-0915.mjs`。

## 0915 追加批 · 第十二处：作用域选项的单选指示移到左侧（已随本批推送）

来源 = 设计师对 `button.settings-scope-option.is-selected`（「为你安装（user）仅在你的用户配置中安装此插件」）的评论：**「radio 应该在左侧」**。

- **改前**：选项是**列式**布局（`flex-direction: column`），标题行 `.settings-scope-option-head` 用 `justify-content: space-between` 把单选圆**推到标题行右端** → 实测圆距选项左缘 **505px**、距右缘 17px；标题与描述左缘俱为 17px。
- **改后**：行式布局「单选圆 + 文本块」，圆的 `aria-hidden` 与按钮的 `aria-pressed` 语义、键盘路径均未变（原 `.settings-scope-option-head` 规则移除）：
  - `SettingsPluginView.tsx`：`<span class="settings-scope-radio" /> + <span class="settings-scope-option-body">{标题, 描述}</span>`；
  - `SettingsPage.css`：`.settings-scope-option { flex-direction: row; align-items: flex-start; gap: 12px }`、新增 `.settings-scope-option-body { display:flex; flex-direction:column; gap:6px; min-width:0 }`、`.settings-scope-radio { margin-top: 1px }`。
- **依据**：单选/复选指示与被选文本同属一个可点区域时，指示符应在文本**之前**（阅读顺序即操作顺序；`design-system.md` 的列表项与状态项均按此组织），且指示符与首行文本垂直居中——`margin-top: 1px` = (标题首行行盒 20px（14px 且 `line-height: normal`）− 圆 18px（16px 盒 + 1.5px×2 边框）) / 2，实测对齐偏移 **0px**（改前圆与标题行同心，也已是 0，视觉无回退）。

### 实测（`verify-scoperadio-0915.mjs before|after`，浅深两档；因本轮改的是 DOM 结构，改前取改动前现网实测而非同帧注入）

| 指标                       | 改前                       | 改后                                                 |
| -------------------------- | -------------------------- | ---------------------------------------------------- |
| 布局方向                   | `column`（标题行右推圆）   | `row`（圆 + 文本块）                                 |
| 单选圆水平位置             | 距左缘 **505** / 距右缘 17 | **距左缘 17** / 距右缘 505                           |
| 文字左缘（标题 / 描述）    | 17 / 17                    | **47 / 47**（内衬 16 + 边框 1 + 圆 18 + 间距 12）    |
| 圆 ↔ 标题首行居中偏移     | 0px（与标题行同心）        | **0px**（对齐首行，`margin-top: 1px`）               |
| 选项盒 / 列表总高 / 弹窗盒 | 540×78 / 540×258 / 590×400 | **逐值不变**                                         |
| 描述行数（三档）           | 1 / 1 / 1                  | **1 / 1 / 1**（文本列可用 476px，最长描述需 ~280px） |
| 未选中态（点第 2 项）      | 圆同在右端                 | 圆同在左端（三行一致）                               |
| 报错                       | —                          | console / pageerror **0 条**（浅深）                 |

- 截图（8 张）：`走查/0915-插件市场/scoperadio-{light,dark}-{before,after}[-second].png`；读数 `scoperadio-0915-{before,after}.json`。

### 残留（未授权，保持原样，带触发语）

- **单选圆与文本块间距 12px**（沿用被移除的标题行 `gap` 值）。触发语 **「单选圆间距改 8」**。
- **指示符仍是「按钮 + 伪元素」**（`button[aria-pressed]` + `.settings-scope-radio::after`），未改为原生 `input[type=radio]`；若要真单选框语义（同组上下键切换）需改结构与交互。触发语 **「作用域用原生 radio」**。
- 第十一处的三条残留与触发语不变。

## 0915 追加批 · 第十三处：插件行主操作按钮字重 600 → 500（与「新建市场」一致）（已随本批推送）

来源 = 设计师对 `button.settings-plugin-act.is-primary`（插件行「安装」）的评论：**「检查按钮字重，和新建市场保持一致」**。

- **改前**：同页两个 14px 级按钮两种字重 —— 页头「新建市场」（`.settings-save-btn` + `.settings-plugin-new-market`）= **500**，插件行主操作（`.settings-plugin-act`）= **600**；同页还有作用域胶囊 500、列表行按钮（更新市场 / 移除市场）400、筛选激活段 600。
- **改动**：`.settings-plugin-act { font-weight: 600 → 500 }` —— 覆盖该族全部 10 个实例与三个变体（`is-primary` 安装 / 更新、`is-installed` ✓ 已安装）。
- **依据**：以「新建市场」为准（其值 500 = `tokens/tokens.css:105` `--cc-font-weight-medium`，也是 `.settings-save-btn` / `.settings-scope-pill` 的既有值）。**契约注记**：skill `theme/element-plus.css:61` 的 `.el-button` 基线是 `--cc-font-weight-regular`（400）；本页按钮历来走 medium(500)，故本处按设计师指示与页内基准对齐、未据契约改档（若将来要按契约收，是一整批的事）。
- **实测**（`verify-pluginact-weight-0915.mjs`，浅深两档；before = 同帧注入 `font-weight: 600 !important` 复现）：

| 按钮     | 类                                  | 改前 → 改后   | 盒            | 文字实测宽     |
| -------- | ----------------------------------- | ------------- | ------------- | -------------- |
| 安装     | `.settings-plugin-act.is-primary`   | **600 → 500** | 88×28（不变） | 28px（不变）   |
| 更新     | `.settings-plugin-act.is-primary`   | **600 → 500** | 88×28（不变） | 28px（不变）   |
| ✓ 已安装 | `.settings-plugin-act.is-installed` | **600 → 500** | 88×28（不变） | 56.6px（不变） |

- **几何零影响的原因**：该族有 `min-width: 88px`，且文案全为全角字（安装 / 更新 / ✓ 已安装），**中文字形宽度不随字重变化**，故文字宽与盒宽前后一致；插件列表总高 **692 → 692**。
- **未越界**：全局设置「保存」、MCP 服务「新增用户级 MCP」、钩子「新增钩子」仍 500（本就同档）；「更新市场 / 移除市场」仍 400 / 12px；筛选激活段仍 600（tab 激活段口径，0915-D-02 指定）；console / pageerror **0 条**（浅深）。
- 截图（4 张）：`走查/0915-插件市场/pluginact-weight-{light,dark}-{before,after}.png`；读数 `pluginact-weight-0915-fix.json`（现状审计 `pluginact-weight-0915.json`）。

### 残留（未授权，保持原样，带触发语）

- **「更新市场 / 移除市场」仍是 400 / 12px**（列表行档，与插件行主按钮 500 不同档）—— 本批只按指示改了 `.settings-plugin-act`。触发语 **「市场操作按钮也用 500」**。
- 第十一处、第十二处的残留与触发语不变。
- 验证脚本：`CC02/verify-pluginact-weight-0915.mjs`；现状探针 `CC02/audit-pluginact-weight-0915.mjs`。

---

## 0915 追加批 · 第十四处：市场 tab 行右侧「更新市场 / 移除市场」与 tab 垂直居中对齐（已随本批推送）

来源 = 设计师对 `div.settings-plugin-market-ops`（「更新市场 移除市场」）的评论：**「这两个按钮和 tab 居中对齐」**。

- **改前成因（逐字回源 `SettingsPage.css` 公共块）**：`.settings-card-toolbar { display: flex; align-items: center }` 把右侧操作区居中在 **tab 条的边框盒**（59px）上；而 `.settings-tabs { height: 59px; padding-top: 12px; border-bottom: 1px }` 的 tab 按钮盒（`.settings-tab { height: 100% }`）落在**去掉 12px 上内衬、再去掉 1px 下边框**的内容区里（46px）——两者中心天然差 6px，故实测按钮中心 **144.5** vs tab 文案中心 **150**，按钮比 tab 高 **5.5px**。
- **改动（1 处，`SettingsPage.css`）**：`.settings-plugin-view .settings-toolbar-actions` 补 `display: flex; align-items: center; align-self: stretch; padding-top: 12px; padding-bottom: 1px` —— 撑满条高并镜像 tab 条自身的纵向内衬（12px 上内衬 + 1px 下边框），使按钮中心与 tab 按钮盒中心重合。
- **实测**（`CC02/probe-tabops-align-0915.mjs before|after`，浅深两档，1440 / DPR2；只改 CSS，故 before = 同帧注入改前声明复现）：

| 项                              | 改前                                   | 改后                                  |
| ------------------------------- | -------------------------------------- | ------------------------------------- |
| 操作组盒                        | 148×28 @ 130.5→158.5（中心 **144.5**） | 148×28 @ 136→164（中心 **150**）      |
| 按钮「更新市场」/「移除市场」   | 71×28，中心 144.5                      | 71×28，中心 **150**                   |
| 选中 tab 文案行盒中心           | 150（tab 盒 127→173，46px 高）         | 150（**不变**）                       |
| 偏差（按钮中心 − tab 文案中心） | **−5.5px**                             | **0px**                               |
| tab 条 / 工具栏盒               | 559.5×59 / 712×59                      | 552×59 / 712×59（条宽变化见第十五处） |
| 筛选分段轨道                    | 276.7×32                               | 276.7×32（不变）                      |

- 浅深两档同值；console / pageerror **0 条**；`pnpm --filter wave-webview exec tsc --noEmit` → exit 0。
- 截图（4 张）：`走查/0915-插件市场/tabops-align-{light,dark}-{before,after}.png`；读数 `tabops-align-0915-{before,after}.json`。

### 残留（未授权，保持原样，带触发语）

- **其余复用 `SettingsTabs` 的视图（MCP 服务 / 规则范围 / 来源范围）操作区仍按旧口径居中在条边框盒上**（同样会偏高 5.5px）—— 本轮按评论点名范围只改插件市场视图。触发语 **「其他设置页的 tab 行按钮也对齐」**。

---

## 0915 追加批 · 第十五处：市场 tab 条显示不下时横向滚动，且不影响右侧按钮（已随本批推送）

来源 = 设计师对 `div.settings-tabs`（「wave-plugins-official 10 / wave-community 3 / …」）的评论：**「tab显示不下的时候应该出现滚动，但不要影响到按钮」**。

- **改前成因**：tab 条与右侧操作区同处一条 `flex-wrap: wrap` 的 flex 行、两者都按内容宽占位 → 市场名较长时（实测三个 tab 内容共 560px）总需求超过容器：

| 视口 | 工具栏盒 | 需求宽                    | 结果（改前，实测）                                                            |
| ---- | -------- | ------------------------- | ----------------------------------------------------------------------------- |
| 1440 | 712×59   | 560 + 12(gap) + 148 = 720 | 操作区被挤出内容右界 **8px**（按钮右缘 1203.6 vs 内容右界 1196）              |
| 994  | 706×59   | 720                       | 溢出 **14px**（983.6 vs 970）                                                 |
| 480  | 228×112  | 720                       | 整条**换行**（条高 59 → 112），按钮被甩到第二行，tab 文案在 46px 高的盒里折行 |

- **改动（3 处，均在 `SettingsPage.css`，作用域 `.settings-plugin-view`）**：
  1. `.settings-card-toolbar { flex-wrap: nowrap }` —— 宽度不足不再换行（换行本身就是「影响到按钮」）。
  2. `.settings-tabs { flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden }` + `.settings-tab { flex: 0 0 auto; white-space: nowrap; outline-offset: -2px }` —— tab 条成为滚动容器、段不收缩不折行。
  3. `.settings-toolbar-actions { flex: 1 → flex: 0 0 auto }` —— 操作区不参与收缩分配，剩余空间全部让给可滚动的 tab 条。
  4. 分隔线从 `border-bottom` 换成 `box-shadow: inset 0 -1px 0 var(--cc-settings-border-light)` 并补 `padding-bottom: 1px`；滚动条按 `.desktop-panel-tabs-strip` 既有口径隐藏（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`）。
- **为什么要换分隔线（像素级原因）**：滚动容器只把子元素裁到 **padding box**，而活跃段下划线是 `bottom: -1px`、正好压在条自身的 `border-bottom` 上（分隔线在边框区、裁剪区之外）→ 直接加滚动会把下划线裁掉 1px（实测 3px → **2px**）且分隔线在下方重新露出。改成 inset 阴影（条自身绘制、排在子元素之前）+ 1px 下内衬后，段盒仍是 46px、中心仍是 150，下划线 3px 完整可见并继续盖住分隔线。滚动条隐藏的理由同源：条内只有这 1px 余量，经典滚动条（Windows/Linux 占 ~8px 布局空间）会把段盒压扁、下划线重新被裁。
- **实测**（`CC02/probe-tabops-overflow-0915.mjs before|after`；before = 同帧回滚本轮四处声明、保留上一轮已确认的居中对齐）：

| 项                          | 改前                                                                                             | 改后                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1440 工具栏                 | 712×59（内容 720，溢 8）                                                                         | 712×**59**（单行）                                            |
| 1440 tab 条                 | 559.5×59，`overflow-x: visible`（滚动 560/560）                                                  | 552×59，`overflow-x: auto`（滚动 **560/552 → 溢 8px**，可滚） |
| 1440 按钮右缘               | 1203.6（= 内容右界 +8）                                                                          | **1196 = 页头「新建市场」右缘（差 0）**                       |
| 994 tab 条 / 按钮右缘       | 559.5，`visible`；983.6（+14）                                                                   | 546（滚动 560/546 → 溢 14px）；**970 = 页头右缘（差 0）**     |
| 480 工具栏                  | 228×112（换行；tab 文案折行）                                                                    | 228×**59**（单行；tab 条 68px 可滚、文案不折行）              |
| 页内横向溢出元素            | `settings-section` / `settings-card-toolbar` / `settings-toolbar-actions` 均 `visible` 溢 8~94px | **仅 `settings-tabs`（`auto`，8~14px）**                      |
| 活跃段下划线（DPR2 逐像素） | 6 个深色行（= 3px），无分隔线露出                                                                | **6 个深色行（= 3px），无分隔线露出（与改前逐行一致）**       |
| 段盒 / 文案                 | 46px 高，折行（480）                                                                             | 46px 高，`nowrap`                                             |

- **键盘与无障碍**：axe-core 4.13.0（`/tmp/axe`，未进仓库依赖）浅深各 **0 违规**（`scrollable-region-focusable` 0 违规 / 2 个通过节点），仅余既有 `region`(moderate) 一条（预览台 `select` 不在 landmark 内，非本轮引入）；键盘 Tab 到首个市场 tab 时焦点环 `2px solid` 且 `outline-offset: -2px`（贴边内环，**不被滚动容器裁切**），滚到最右时末个 tab 完整可见（右余 0.4px）。
- 截图：`走查/0915-插件市场/tabops-overflow-{1440,994,480}-{before,after}.png`、`tab-underline-{before,after}.png`、`tabscroll-focus-first.png` / `tabscroll-focus-last.png` / `tabscroll-scrolled-end.png`；读数 `tabops-overflow-0915-{before,after}.json`、`tab-underline-0915-{before,after}.json`、`tabscroll-keyboard-0915.json`、`axe-tabscroll-0915.json`。

### 残留（未授权，保持原样，带触发语）

- **480 窄窗下 tab 条只剩 68px 宽**（可用 228 − 按钮 148 − 间距 12）—— 按钮已按评论要求「不受影响」，但 tab 只剩一条缝；该视口下预览页本身也已横向溢出（插件行比卡片宽 52~94px，非本轮引入）。触发语 **「窄窗 tab 条太窄」**。
- **tab 条自身没有键盘焦点**（`tabindex` 未加）—— 当前键盘可达性依赖条内的 tab 按钮（axe 通过、焦点会走到各按钮）；若要支持方向键直接滚动整条，需给条加 `tabindex="0"`。触发语 **「tab 条也给键盘聚焦」**。
- 第十四处的残留（其他设置页视图）与第十~十三处的残留不变。
- 验证脚本：`CC02/probe-tabops-align-0915.mjs`、`CC02/probe-tabops-align-narrow-0915.mjs`、`CC02/probe-tabops-overflow-0915.mjs`、`CC02/probe-tab-underline-clip-0915.mjs`、`CC02/probe-tabscroll-keyboard-0915.mjs`、`CC02/audit-plugin-tabscroll-0915-axe.mjs`。

## 0915 追加批 · 第十六处：设置页左导航「插件市场」图标按 skill 归一 + 设计师 Figma 版替换（已随 0915 批推送）

来源 = 设计走查对本页的追加评论（`svg.header-icon`，DOM `aside > nav > div:nth-of-type(3) > div > button:nth-of-type(1) > svg`，即左导航第三组「AI 与扩展」第一项「插件市场」）：「帮我把图标按照skill换一下 和其他图标保持一致」。后续她追加两条指示：「把插件市场图标保存为svg到桌面，我需要稍微调整一下」→ 我导出可编辑版 → 「保存到原位置了，替换一下就好」→ 按她的 Figma 导出替换。

### 依据（逐字）

- skill `icon.md` 优先级 1：「Reuse the icon component or asset already used by CodeChat for the same action.」→ codechat-ui 原型 `src/features/settings/settings-navigation.ts` 的「AI 与扩展」四项为 技能和指令 / 子代理 / 钩子 / MCP 服务，**没有插件市场条目**，同源资产不存在。
- skill `icon.md` 优先级 3：「For a new generic utility action with no existing asset, use the single icon library already installed in the target project.」→ wave 已在用 lucide（`SettingsGearIcon`/`HouseIcon`/`FileTextIcon`/`HelpCircleIcon`/`LogOutIcon`/`SplitIcon`/本项均为 lucide path 内联）。
- skill `icon.md`：「**Do not mix libraries within one surface**」「Wrap frequently reused icons in a product component so **size, stroke, color**, and accessibility remain consistent」「**Use `currentColor`** so hover, active, disabled, and danger states follow the control token」「Verify alignment optically; do not rely only on equal bounding boxes.」
- ⚠️ Figma API 侧仍未核对（本轮两个访问令牌均返回 `403 Forbidden`，疑似过期）；**本轮最终形状由设计师本人在 Figma 调整后导出**，不需要 API。

### 步骤 1 · 根因与归一（实测）

| 项                   | 原实现                    | 同面其余 7 项  |
| -------------------- | ------------------------- | -------------- |
| `viewBox`            | `0 0 24 24`               | `0 0 16 16`    |
| `stroke-width`       | 1.4（24 网格）            | 1.4（16 网格） |
| **effective stroke** | **1.4 × 16/24 = 0.933px** | **1.4px**      |

lucide 原稿按 24 网格出图，直接塞进 16px 盒后 1.4 被等比缩成 0.933，比同面其余图标**细 33%**（DOM 采样 8 项里只有本项 `viewBox=0 0 24 24`）。按 skill 的「同一面内口径一致」先把渲染口径归一。

### 步骤 2 · 设计师 Figma 版替换（最终形状）

- 她调整后的文件：`~/Desktop/招商局/插件市场图标.svg`（Figma 导出，4254 B）。替换时按 skill 只做两处规范化，**path 逐字照搬**：
  1. 去掉导出外壳（`<g clip-path="url(#clip0_…)">` + `<defs>` 里的 16×16 矩形 `clipPath`，无视觉作用），只留 `<path>`，与同面其余图标结构一致；
  2. `stroke="black"` → svg 级 `stroke="currentColor"` + `strokeWidth={1.4}`（浅色 #565A60 / 深色 #9A9EA5 由 CSS 控）。
- 最终组件：`HeaderIcons.tsx` `SettingsPluginsIcon`（`viewBox="0 0 16 16"` / `stroke-width 1.4` / bare `<path>`）。

### 实测（4× 设备像素 + DOM，浅深两档）

| 指标                 | 原实现（24 网格） | 步骤 1 归一后 | **步骤 2 她的版本（最终）** | 同面其余 7 项         |
| -------------------- | ----------------- | ------------- | --------------------------- | --------------------- |
| `viewBox`            | `0 0 24 24`       | `0 0 16 16`   | **`0 0 16 16`**             | `0 0 16 16`           |
| 渲染笔画             | 0.933             | 1.4           | **1.4**                     | 1.4                   |
| path 中心线 bbox     | 13.33（= 20×2/3） | 13.33         | **11.515 × 11.514**         | —                     |
| 墨迹外接盒（含笔画） | 14.5 × 14.5       | 15 × 15       | **13.0 × 13.0**             | 12.5~15（12.5~14.25） |
| 墨迹像素数           | —                 | —             | **1425**                    | 953~1750              |
| 横切 run 中位数      | 1.5               | 2.25          | **2.25**                    | 1.75~2.25             |

> run 中位数**受斜率影响**（45° 段横切更长）：同面「MCP 服务」为已知 1.4 笔画、中位数同为 2.25；「技能」等轴对齐段为 1.75 —— 步骤 2 落在同一区间，笔画与同面一致。
> **尺寸差异须知**：她的形状中心线 11.515（含笔画 13.0），比步骤 1 的 13.333（含笔画 15.0）**小约 13.6%**，墨迹位置 x/y 1.5 → 14.5（步骤 1 为 0.5 → 15.5）。但**仍落在同面其余图标的实测区间内**（「全局设置」12.5、「钩子」13.5、「技能/子代理」15×12.5），故按她的指示原样替换、未做缩放。

- **逐像素回归**（步骤 1 → 步骤 2）：整条导航（956×3464 设备像素）差分外接框 = `x 20.8–35.2, y 231.8–246.2`（CSS px）= 恰好「插件市场」16×16 盒内，浅深各 1464 个差异像素；其余 7 项与文字、分隔线、选中底**零像素变化**。
- 对照图：`走查/0915-插件市场/navicon-{light,dark}-lucide归一-vs-她的版本.png`（左 = 步骤 1，右 = 她的版本）；`navicon-{light,dark}-{before,after}.png`。
- 浅深两档均实测；`pnpm -F wave-webview type-check` 全绿（退出码 0）。

### 影响面

`SettingsPluginsIcon` 全仓仅 1 处引用（`SettingsPage.tsx:208` 左导航「插件市场」），无其他面受影响。

### 残留（未授权，供后续点名；不在本轮范围）

- **图标比同面多数项略小**（墨迹 13.0 vs 多数 15.0，仍在区间内）——若她要求放大到与「技能/子代理」同档，需把 path 等比放大 13.333/11.515 ≈ 1.1579 并重算落点。触发语 **「插件市场图标放大到同档」**。
- 桌面根目录 `~/Desktop/插件市场图标.svg` 是我导出给她的**可编辑原稿（步骤 1 版）**；她的调整版在 `~/Desktop/招商局/插件市场图标.svg`。两份都在，未删改她的文件。
- skill 回写候选（交 codex 审）：`icon.md` 可补实现陷阱 ——「n 网格图标库（lucide 24）用于 16px 盒时必须补偿 stroke（`scale(2/3)` + `strokeWidth ÷ 2/3`），否则 1.4 会渲染成 0.933，与同面 Figma 直出图标不成比例」；以及「Figma 导出的 `<g clip-path>` + 16×16 矩形 clipPath 外壳可直接去掉，改 `currentColor` 即可内嵌」。触发语 **「图标网格补偿写进 skill」**。
- 其他导航图标若有同类网格混用（本页仅此 1 项曾存在），触发语 **「全站图标网格口径复核」**。

### 验证脚本与证据

- 脚本：`CC02/probe-settings-navicon-0915.mjs`（DOM + 4× 导航截图，浅深两档）；步骤 2 采样用 `/tmp/probe-navicon-after.mjs`。
- 证据目录 `CC02/走查/0915-插件市场/`：`navicon-{light,dark}-{before,after}.png`、`navicon-{light,dark}-lucide归一-vs-她的版本.png`、`navicon-0915-{before,after}.json`。

## 0916 第 1 轮：右侧面板拖拽分隔线（`.panel-slot-drag-handle`）→ 2px 中间深两端浅的渐变细线（已随本批推送）

用户 2026-09-16 预览评论（元素 `div.panel-slot-drag-handle`）：「拖拽界面宽度时会有个 hover 和选中都会变色的线，细一些 2px 左右、中间深两边浅的渐变，参考 codex 但比 codex 再明显一些，**只改线的样式不改功能和交互**」；同轮追加选定「**用 B**」= 浅色核心换次级灰 `#6C7076`、深色不变、两端降到 8%。

### 改前 → 改后

| 状态   | 改前                                                              | 改后                                                                                                             |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| hover  | 整条 **6px 命中区实色填充**（浅 `#1F2329` / 深 `#A0A5A8`）        | **2px 细线 + 竖向渐变**：中间深两端浅，实色核心占 20%–80% 高度，两端淡出 **8%**；核心浅 `#6C7076` / 深 `#A0A5A8` |
| 拖拽中 | 同上（`ChatApp.tsx` mousedown 写内联 `background`、mouseup 清空） | 同上（由既有的 `body.is-panel-resizing` 在 CSS 点亮——指针跑出命中区仍保持亮起）                                  |
| 静止   | 无                                                                | 无（`opacity:0`，加 120ms 淡入）                                                                                 |

实现：线画在 `.panel-slot-drag-handle::after`（`width:2px` / `left:50%` / `margin-left:-1px` / `pointer-events:none`），**6px 命中区原样保留**；取色走规则内局部变量 `--panel-drag-line: var(--cc-text-secondary, var(--vscode-focusBorder, #007fd4))`（插件端无 `--cc-*` 层时回落 host 焦点色，行为不变）。`ChatApp.tsx:2701` 只删掉 mousedown/mouseup 两处内联 `background` 写入，拖拽逻辑（宽度计算、`CHAT_MAIN_MIN_WIDTH` 守卫、全局光标锁定、webview 命中穿透）**零改动**。

### 实测（用例 `desktop-full`，浅/深双主题，DPR2）

- 线宽：12 设备像素（6 CSS px）→ **4 设备像素（2 CSS px）**；命中区 6px 不变。
- 渐变（线上像素采样）：浅色 顶 `rgb(240,240,241)` → 中 `rgb(108,112,118)` → 底 `rgb(237,237,238)`；深色 `rgb(30,31,32)` → `rgb(160,165,168)` → `rgb(29,30,31)`。
- 静止 `opacity:0`；hover 与拖拽中恒为 `1`（指针移出命中区 50px 仍亮）；0 pageerror。
- 拖拽功能基线复核：用 `git stash` 抽出本轮改动重测改前代码，clientX 轨迹（528→478）、`is-panel-resizing` 类、`col-resize` 全局锁定、面板宽度**逐值相同**。
- 说明：预览用例里整行只有 589px 宽，展开后一拖面板即落到 229px（对话列卡在 `CHAT_MAIN_MIN_WIDTH` 360px）——既有约束，改前改后一致，非本轮引入。

### 残留（未授权，供后续点名；不在本轮范围）

- 其它窗口/侧栏的拖拽分隔线是否统一成这条 2px 渐变线 —— 触发语 **「侧栏分隔线也统一」**。
- 浅色核心若嫌偏浅/偏深：备选 **A** = 炭黑核心 `#1F2329` + 两端 20%（触发语「用 A」）；备选 **C** = 常规灰核心 `#565A60`/`#C4C7C9` + 两端 8%（触发语「用 C」）。深色下 A 与 B 同色。
- skill 回写候选（交 codex 审）：拖拽分隔线可补一条实现陷阱 ——「**命中区与可视线必须分离**：命中区宽度决定拖拽手感（此处 6px），可视指示线画在伪元素上（2px）；若直接把 `:hover` 底色铺在命中区上，线会随命中区变粗，且拖拽期间 `:hover` 因指针跑出命中区而丢失，须由 `body.is-*-resizing` 之类的全局类点亮」。触发语 **「分隔线实现陷阱写进 skill」**。

### 验证脚本与证据

- 脚本：`CC02/shots-draghandle-0916.mjs`（注入改前样式做同页对照 + 三态裁剪）、`CC02/variants-draghandle-0916.mjs`（强度档对照）、`CC02/verify-draghandle-fn-0916.mjs`、`CC02/verify-draghandle-drag-0916.mjs`、`CC02/build-draghandle-report-0916.py`。
- 证据目录 `CC02/走查/0916-分隔线/`：`{light,dark}-{before,after}-{hover,drag}.png`、`zoom-*.png`（5× 线宽放大）、`cmp-*-ctx.png`（强度对照上下文）、`measure-0916.json`、走查页 `0916-分隔线-review.html`（Artifact https://codechat.codewave.163.com/code/artifact/b27xy4jugh）。
- `pnpm -F wave-webview type-check` 全绿（退出码 0）；`oxlint` 对改动文件 0 error（仓库现有 2 error 在未跟踪的 `prototype/mockShared.ts`）。

## 0916 第 2 轮：左侧导航 / 下拉菜单 / 右侧面板 tab 的选中态与选项字重统一 400（已随本批推送）

用户 2026-09-16 预览评论（原话）：「我希望左侧导航包括设置页的左侧导航、所有下拉菜单、右侧展开区域的 tab 页，选中状态字重都不变，保持 400（现在未选中应该是 400），下拉菜单中的选项默认也是 400，**全局调整**」。口径 = 选中与否、默认与命中，都不再用字重区分，选择只由底色/描边表达。

### 改前 → 改后（桌面端 `[data-host="desktop"]` 计算值）

| 位置                                                                                | 改前                                                        | 改后            |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------- |
| 左侧导航 · 会话列表**选中**标题                                                     | `500`（`--cc-font-weight-medium`）                          | 400             |
| 左侧导航 · 未选中标题                                                               | 400                                                         | 400（原本即是） |
| 设置页左侧导航 · 选中项（`.settings-nav-item.is-active`）                           | `500`                                                       | 400             |
| 右侧面板 tab · 选中页签文案（`.desktop-panel-tab.active`）                          | `500`（契约 `design-system.md:138` 本写 regular，实现偏离） | 400             |
| 下拉选项：会话行菜单 / 加号 / 权限模式 / 工作目录 / 快捷指令列表 / 账户个人信息菜单 | `500`                                                       | 400             |
| 文件建议弹层选项名（`.suggestion-name`，含键盘命中 `.kb-option`）                   | `500` / `600`                                               | 400             |
| 会话列表弹层项 / 工作目录下拉「当前分支」项                                         | `500` / `600`                                               | 400             |

实现落点：

- `host-desktop.css` 新增 **⑧ 组**（七条 `[data-host="desktop"] …` 选择器统一 `var(--cc-font-weight-regular, 400)`）：面板页签 active、设置页导航 active、`.suggestion-name`、`.suggestion-item.kb-option .suggestion-name`、`.slash-command-name`、`.session-list-item-title`、`.desktop-branch-active .desktop-workdir-menu-name`。
- 就地改值：`.permission-mode-item`（427）、`.plus-menu-item`（648）、`.more-menu-item` / `.panel-toggle-menu-item` / `.desktop-session-menu-item` / `.desktop-workdir-menu-item` 同组（1799）、会话选中标题（723）、`DesktopApp.css:316`、`DesktopPanelTabs.css:86`。
- 移出旧组：`.suggestion-item.kb-option .suggestion-name` 从 ④ `600` 组移出（否则覆盖 ⑧）；`.desktop-panel-tab.active .desktop-panel-tab-label` 与 `.permission-mode-item` 从 ② `500` 组移出。
- **base 文件不改**（IDE 端不受影响，沿用 0904 约定）：`MoreMenu.css` / `PanelToggleMenu.css` / `SessionListPopup.css` / `SlashCommandsPopup.css` / `FileSuggestionDropdown.css` / `SettingsPage.css` / `MessageInput.css` 里的 500/600 保持原样，桌面端由 host 覆盖层接住。

### 实测（同页回退对照 = 注入旧值当「修复前」，用例 `desktop-full`，1440×900，深色）

- 计算值：上表全部命中（`500/600 → 400`）；未选中项与未改项逐值不变。
- 几何：**行盒与菜单容器逐值不变**（`211x22` 会话标题、`146x28` 权限项、`160x28` 加号项、`217x28` 账户项、`215x30` 设置页导航项…）；唯**工作目录下拉因菜单宽度由内容决定窄 5px**（`280x150 → 275x150`，高不变）—— 字重变细带来的字宽差（400 比 500 窄约 1–2%），非布局缺陷。
- 0 pageerror；截图 4 组（左侧导航 / 权限下拉 / 账户菜单 / 设置页导航）差异像素 2.29% / 10.45% / 4.00% / 0.42%，差异仅落在文字笔画上。
- 右侧面板 tab：原型 mock 用例**都开不出面板 tab**（tab 由真实交互/宿主驱动），故该项用「同页级联计算值」验证（注入同 class 链节点读 computed font-weight：`500 → 400`）；真机走查路径 = 头部「展开面板 → 预览」。

### 残留（未授权，供后续点名）

- 下拉/导航内的**分组标签**仍 500（最近打开 / SSH 主机 12px、快捷指令分组标题、设置页导航分组标题）—— 0908 曾按用户点名「加粗」，故本轮不动 → 触发语 **「分组标签也改 400」**。
- 设置页**内容区** tab（`.settings-tab.is-active` 500）、弹窗分段 tab（`.settings-modal-seg-item.is-active` 600）、插件市场筛选胶囊（`.settings-plugin-chip.is-active` 600）：不属本轮三个范围 → 触发语 **「设置页 tab 也改 400」**。
- 插件行按钮 `.settings-plugin-act` 500 = 0915 用户明确定的档（与「新建市场」同档），**不动**。
- 列表/标题类 600（`.desktop-panel-toolbar-title`、`.settings-plugin-name`、`.session-card-title`、`.desktop-panel-empty-title` 等）未动 → 触发语 **「面板标题也改 500/400」**。
- IDE（VS Code / JetBrains）宿主仍按 base 渲染 500（本轮只改桌面端语义层）→ 触发语 **「IDE 也一起改」**（需改 base 文件）。
- 唯一可见副作用：工作目录下拉窄 5px；若要宽度恒定 → 触发语 **「工作目录菜单宽度钉死」**。
- skill 回写候选：见交接单 **W-25 ~ W-29**（`~/Desktop/skill-backfill-0916-fontweight-for-codex.md`）。

### 并行窗口说明

`packages/webview/src/styles/DesktopApp.css` 的会话选中标题一行（`.desktop-session-item--current .desktop-session-title`，500 → 400）写入工作区后，被另一个窗口的第 1 轮提交 `0a250209`（拖拽分隔线）一并带走并推送——该行**已在远端分支**，但记录归在第 1 轮小节；本轮其余改动已随本批推送。

同一份 `host-desktop.css` 当时还含另一窗口在途的两处改动（0916 评论② 工具行内控件圆角 8px、账户热区深色 hover 回接 `--cc-fill-hover`），与本轮 hunk 不重叠；本批提交**只取本轮 7 条 hunk**（用临时索引 `GIT_INDEX_FILE` 组装，未动共享索引里他窗口已暂存的内容），推送版里那两处仍是改前值。

### 验证脚本与证据

- 脚本：`CC02/verify-fontweight-0916.mjs`（同页回退对照 + 计算值/盒尺寸表）、`CC02/shots-fontweight-0916.mjs`（前后裁剪图 + 面板 tab 级联校验）。
- 证据目录 `CC02/走查/0916-字重/`：`dark-{before,after}-{nav-session,menu-permission,menu-account,nav-settings}.png`、`verify.json`。
- 本轮无 TS 改动（纯 CSS 字重），未跑 type-check。

---

## 0916 账户热区 hover 审计 →（用户改判）侧栏 hover 统一到「普通会话行」档：深色 8% 白 / 浅色 `--cc-fill-hover`（已随本批推送）

### 起因与审计结论

8899 预览走查评论 `div.account-card-hotzone`（侧栏底部账户卡片个人信息行，「Aadmin@corp.netease.com」）「检查深色模式这里的hover色是否符合规范」。审计结论 = **不符合规范**（审计页 Artifact https://codechat.codewave.163.com/code/artifact/n7n3rgt6xk ，审计 only 未改码）：

- 深色生效规则是裸 alpha `rgba(255,255,255,.14)`（`host-desktop.css:764-766`），未消费语义 hover 面 token；叠侧栏底 `--cc-bg-navigation #181A1B` 后实测渲染 `#383A3B` —— 比契约 hover 面 `--cc-fill-hover #303436` 亮 **+8/+6/+5**，而与契约按下面 `--cc-fill-pressed #393E41` 只差 **−1/−4/−6**（即普通 hover 用掉了按下档亮度）。
- 同侧栏层级倒挂：普通会话行 hover 8% 白（合成 `#2A2B2C`）比契约还暗一档；「当前会话」持久选中 12% 白（合成 `#343536`）**比热区 hover 更暗**。
- 浅色同族同样偏出且方向不一致：热区 `#E2E4E8` 比契约 `#EEF0F3` 重一档、比按下面 `#E7E9ED` 还重；而同侧栏会话行 /「新建对话」浅色 hover 都已是 `#EEF0F3`。
- 值出处（非本轮回归）：第十二轮「hover `#E2E4E8`（深色 14% 白）保留」，当轮验收表只测了浅色 `rgb(226,228,232)`，深色值未做像素验收。

### 权威依据（逐字）

- skill `theme/desktop-colors.css:147` `--cc-fill-hover: #303436;`（深色档；`:49` 浅色 `#eef0f3`），且 `scripts/build_desktop_dark.py:37` 将其列入 user-approved 集。
- skill `references/desktop-theme-bridge.md:15`：| `--vscode-list-hoverBackground` | `--cc-fill-hover` | **Ordinary row hover** |。
- skill `references/dark-theme.md`：State backgrounds are opaque for predictable layering. Alpha is reserved for scrollbar thumbs, scrims, focus rings and shadows where compositing is intentional.
- skill `references/design-system.md:171` 只规定了热区几何（`30px` tall），未单列 hover 色值 → 适用通用 hover 面契约。
- 用户 0916 指示（两步）：先 **「按 A 改，新对话的hover态一起改」**（A = 深色档回接 `--cc-fill-hover #303436`），实施并自测后用户追问 **「账户热区 hover、新建对话 hover，可以统一成普通会话行 hover（8% 白）吗？会有什么问题吗，hover为什么会有这么多颜色」** → 我给出四档实测对比（决策页 Artifact https://codechat.codewave.163.com/code/artifact/h13p0js8q6 ，含真元素 4 档并排与对比度步长）后，用户裁决：**统一范围 = 账户热区 + 新建对话 + 账户卡「更多」按钮；浅色同步**（即 A 档被本次覆盖）。

### 为什么会有多套 hover 颜色（供契约侧参考）

三套来源并存、且互不拉通：① 契约语义 hover 面（不透明 `#303436`/`#EEF0F3`）为**浮层/面板面**设计，落在更暗的导航底上会变成「重一步」；② 侧栏手写 **α 阶梯**（6% / 8% / 12% / 14% 白）——早期深色无 Figma 权威帧，逐轮按单组件评论定「中性百分之几白」，从无一次拉通；③ VS Code 宿主 token（`list-hoverBackground` 已桥接、`toolbar-hoverBackground` 未桥接）。根因：**不透明定值在不同面上步长不同，α 白则到处近似**，「一个值走全站」与「每面步长一致」不可兼得。

实测对比度步长（vs 深色导航底 `#181A1B`）：8% 白 `#2A2B2C` = **1.231**｜`--cc-fill-hover #303436` = 1.389｜选中 12% 白 `#343536` = 1.421｜原 14% 白 `#383A3B` = 1.527｜`--cc-fill-pressed #393E41` = 1.613。浅色参照（vs `#F7F8FB`）：`#EEF0F3` = 1.075、`#E2E4E8` = 1.199、选中 `#EBEDF0` = 1.104。→ 关键结论：用契约值会让侧栏 hover（1.389）与持久选中（1.421）几乎同亮（差 0.03），**8% 与选中差 0.19，阶梯干净**；且深色 8% 已是浅色 hover 的 1.6 倍步长，不存在「太轻看不见」。

### 变更点（`packages/webview/src/styles/host-desktop.css`，共 5 条规则）

| 选择器                                                               | 修复前                  | 修复后                          |
| -------------------------------------------------------------------- | ----------------------- | ------------------------------- |
| `[data-theme="dark"] .account-card-hotzone:hover`                    | `rgba(255,255,255,.14)` | `rgba(255, 255, 255, 0.08)`     |
| `[data-theme="dark"] .desktop-sidebar-new-chat:hover:not(:disabled)` | `rgba(255,255,255,.14)` | `rgba(255, 255, 255, 0.08)`     |
| `[data-theme="dark"] .account-card-more-btn:hover`                   | `rgba(255,255,255,.14)` | `rgba(255, 255, 255, 0.08)`     |
| `[data-theme="light"] .account-card-hotzone:hover`                   | `#e2e4e8`               | `var(--cc-fill-hover, #eef0f3)` |
| `[data-theme="light"] .account-card-more-btn:hover`                  | `#e2e4e8`               | `var(--cc-fill-hover, #eef0f3)` |

浅色「新建对话」原本即 `#eef0f3`（= fill-hover），未动。三处规则上方均补了逐字裁决依据注释。**未动**：常态透明、焦点态、几何（热区 `201×30` / 新对话 `235×30` / 更多 `32×32`）、圆角、字色、「当前会话」选中 12% 白。

### 实测（Playwright 探针，用例 `desktop-full` + `tmp-account-logged-out`，深/浅，渲染像素 = 裁切图众数）

| 元素（深色）                    | 修复前                            | 修复后                                    | 说明                                            |
| ------------------------------- | --------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| 账户热区 hover                  | `#383A3B`                         | **`#2A2B2C`**                             | 8% 白 = 普通会话行档 ✓                          |
| 新建对话 hover                  | `#383A3B`                         | **`#2A2B2C`**                             | 同上 ✓                                          |
| 账户卡「更多」按钮 hover        | `#383A3B`                         | **`#2A2B2C`**                             | 同排两控件不再分档 ✓（修复前值 = 同面注入渲染） |
| 普通会话行 hover / 当前会话选中 | `#2A2B2C` / `#343536`             | `#2A2B2C` / `#343536`                     | 未动；hover 与选中差 0.19 ✓                     |
| 浅色：热区 / 「更多」 / 新对话  | `#E2E4E8` / `#E2E4E8` / `#EEF0F3` | **`#EEF0F3`** / **`#EEF0F3`** / `#EEF0F3` | 浅色侧栏 hover 现在只有一个值 ✓                 |

- `0 pageerror / 0 console error`（两个用例均 0）；before/after 裁切图尺寸逐张一致（热区 `402×60`、行 `470×60`、更多按钮 `64×64` @DPR2）。
- 「更多」按钮仅在未登录态渲染（`DesktopSidebar` 需 `account !== null` 才挂载账户卡），故新增临时用例 `prototype/mock/tmp-account-logged-out.ts`（`mock/` 目录 gitignore、不进推送集）。

### 统一后的侧栏阶梯（深色，已实测）

| 交互级别                       | 值                  | 步长  | 用于                                                              |
| ------------------------------ | ------------------- | ----- | ----------------------------------------------------------------- |
| 弱化（非聚焦 pane 的当前会话） | 6% 白 `#222425`     | 1.170 | 已有，未动                                                        |
| 普通 hover                     | **8% 白 `#2A2B2C`** | 1.231 | 会话行 / 分组头 / 全部菜单项 / 新对话 / 账户热区 / 账户卡「更多」 |
| 持久选中                       | 12% 白 `#343536`    | 1.421 | 当前会话，未动                                                    |

### 残留（未授权，供后续点名）

- `.account-card-collapse-btn`（账户卡用量区显隐按钮）base 吃 `--vscode-list-hoverBackground` → 深色 hover = `#303436`（1.389），与同卡另两个控件不同族 → 触发语 **「账户卡用量显隐按钮也一起」**。
- 更大范围「一个 hover 值走全站」：需把侧栏 hover 抬到 `#303436`、选中抬到 `--cc-fill-pressed #393E41`，牵动菜单/下拉/设置页/表格行所有面，浅色选中也要从 Figma `#EBEDF0` 换成 `#E7E9ED` → 触发语 **「全站深色 hover 面回接 fill-hover」**（未开单）。
- **契约回写（我的动作，待办）**：向 codex 交交接单 —— 在 `references/desktop-theme-bridge.md` 补「导航面按 α 阶梯：hover 8% / selected 12% / weak 6%」，并说明语义 hover token `#303436` 的适用面为浮层/面板面；否则 skill 的「ordinary row hover = `--cc-fill-hover`」与本实现继续冲突。

### 验证脚本与证据

- 脚本：`CC02/probe-account-hotzone-hover-0916.mjs`（深/浅 × 热区/会话行/当前会话/新对话，computed + 裁切图 + `measure.json`；第二遍走 `tmp-account-logged-out` 用例采 `.account-card-more-btn` 真 after 图 → `measure-morebtn.json`）、`CC02/probe-hover-ladder-0916.mjs`（真元素注入 4 档候选 hover 值并裁切 → `走查/0916-账户热区hover/candidates/` + `candidates.json`）、`CC02/build-account-hotzone-review-0916.py`（审计页）、`CC02/build-hover-ladder-0916.py`（档位决策页）、`CC02/build-hotzone-fix-verify-0916.py`（修复自测页，before 图自审计页内联图按序提取）。
- 证据目录 `CC02/走查/0916-账户热区hover/`：`0916-账户热区hover-走查.html`（审计页，Artifact https://codechat.codewave.163.com/code/artifact/n7n3rgt6xk ）、`0916-账户热区hover-修复自测.html`（Artifact https://codechat.codewave.163.com/code/artifact/s9cn0ij7b4 **v2**）、`0916-hover档位候选对比.html`（决策页，Artifact https://codechat.codewave.163.com/code/artifact/h13p0js8q6 ）、`before-after/`（27 张 before/after 裁切图）、`measure.json`、`measure-morebtn.json`。
- 临时用例 `packages/webview/prototype/mock/tmp-account-logged-out.ts`（`mock/` gitignore、不进推送集）。
- 本轮纯 CSS（无 TS/JS 改动），未跑 type-check。

### 并行窗口说明

`host-desktop.css` 与 `docs/desktop-density-restore.md` 为多窗口共用文件，同期另一窗口在做「0916 字重统一 400」三条评论——其批次已分别提交（`e75a4e74` 第 2 轮 / `dea19a19` 评论③），**故本批推送时已无在途混推风险**。本轮 5 条规则 hunk 为 `host-desktop.css` 的 `:746-758`（新对话）/ `:765-780`（热区）/ `:782-795`（更多按钮）。

## 0916 第 3 轮：输入工具行（`.input-buttons-row`）控件圆角统一 8px（评论②）（已随本批推送）

用户 2026-09-16 预览评论（元素 `div.input-buttons-row`「修改前询问发送」）：「这里的元素圆角统一成 8px，现在有些 6px 的」。口径 = 工具行内控件圆角收成同一档 **8px**（原 6px 一档的来源不同：图标按钮是桌面端覆盖值、权限选择器是继承基座值），**只改圆角，不动尺寸 / 配色 / 间距 / 交互**。

### 改前 → 改后（桌面端 `[data-host="desktop"]` 计算值）

| 控件（工具行内）                     | 改前                                                   | 改后                                    |
| ------------------------------------ | ------------------------------------------------------ | --------------------------------------- |
| 工具行图标按钮（添加 / 快捷指令）    | `6px`（base 4px → 桌面端覆盖 6px，`host-desktop.css`） | **`8px`**（`var(--cc-radius-md, 8px)`） |
| 权限模式选择器（修改前询问）         | `6px`（继承 base `MessageInput.css:219`）              | **`8px`**（显式落到本节规则上）         |
| 发送 / 停止按钮（`.ai-send-btn` 等） | `8px`（与 Figma 一致）                                 | `8px`（本轮未动）                       |

实现：`host-desktop.css` 里 `.toolbar-icon-button` 的 `border-radius: 6px` → `var(--cc-radius-md, 8px)`（并在上方注释标明 4 → 6 → 8 的沿革与依据），`.permission-mode-select` 规则内新增 `border-radius: var(--cc-radius-md, 8px);` 一行 + 依据注释。两处均只写桌面端语义层，**基座文件（`MessageInput.css`）不动，插件端不受影响**。注意 `--cc-radius-md` 在本仓库**没有变量定义**（它是 skill 契约里的角色名），实际生效值来自 `var()` 的字面量兜底 `8px`——与既有写法一致。

### 实测（用例 `desktop-full` / `desktop-new-chat`，浅/深双主题，DPR2，共 8 组）

- 计算值：图标按钮 `6px → 8px`、权限选择器 `6px → 8px`、发送按钮恒 `8px`，8 组场景**逐组命中**。
- 盒尺寸零变化：图标按钮 `32×32`、权限选择器 `112×32`、发送按钮 `32×32`（前后逐值相同）；工具行高 `32px`、12px 内衬、间距未动。
- hover 面零变化（背景非本轮目标，用于确认没连带改色）：浅色图标行 `rgb(240,242,245)`、浅色权限 `rgb(238,240,243)`、深色两者 `rgba(255,255,255,0.08)`，前后一致。
- `0 pageerror / 0 console error`；before/after 裁切图尺寸逐张一致。
- **取证踩坑（供后续复用）**：这三个控件静止态 `background: transparent`，权限选择器连描边也透明 —— 直接截静止态，改前/改后两张图**逐字节相同**（第一版 md5 一致才发现），必须**逐个 hover 后再裁剪**才能看见圆角。

### 残留（未授权，供后续点名；不在本轮范围）

- 弹出层圆角仍是各自口径 —— `.permission-mode-menu` 权限下拉 `4px`、`.tooltip-box` 气泡 `2px`（`.plus-menu` 已是 8px）→ 触发语 **「下拉与气泡圆角也统一」**。
- 插件端（VS Code / JetBrains）同名控件仍是基座的 `4px` / `6px`（本轮只改桌面端 host 层）→ 触发语 **「插件端也统一」**。
- 工具行之外、同一面板里的其它 6px 控件（如会话列表行内按钮等）未动 → 触发语 **「面板内其余 6px 也统一 8」**。
- skill 回写候选（交 codex 审）：工具行内控件的圆角档位建议在契约里写明「同一工具行内的可点控件共用一档圆角（8px / `--cc-radius-md`）」，避免出现「图标按钮走覆盖值 6px、选择器继承基座 6px、发送按钮 8px」这种同排三来源 → 触发语 **「工具行圆角口径写进 skill」**。

### 验证脚本与证据

- 脚本：`CC02/probe-inputrow-radius-0916.mjs`（8 组场景 computed + 盒尺寸 + hover 裁切图）、`CC02/build-inputrow-report-0916.py`（走查页）、`CC02/shot-report2-0916.mjs`（复核截图）。
- 证据目录 `CC02/走查/0916-输入行圆角/`：`hover-{toolbar,perm,send}-{light,dark}-{desktop-full,desktop-new-chat}-{before,after}.png`（含 `-z2` 2× 放大版）、`row-*.png` / `zoom-*.png` / `half-*.png`、`measure-0916-inputrow.json`、走查页 `0916-输入行圆角-review.html`（Artifact https://codechat.codewave.163.com/code/artifact/3mowwjf1rt）。
- `pnpm -F wave-webview type-check` 退出码 0（本轮纯 CSS，无 TS 改动）。

### 并行窗口说明

本批提交**只取本窗口（评论②）的内容**：`host-desktop.css` 的 3 条 hunk（`:277-289` 图标按钮、`:336-352` 权限选择器）用**共享索引里已暂存的快照**提交；`docs/desktop-density-restore.md` 用「HEAD 版本 + 本节」组装的 blob 写入索引（`git update-index --cacheinfo`），因此**同一文件里另一窗口在途的「账户热区 hover 审计」小节与 `host-desktop.css` 的 `:750-752` / `:764-766` 两条 hunk 均未进入本提交**，仍留在工作区。与本轮同批推送的第 2 轮（字重 400）由另一窗口独立提交。

---

## 0916 评论③：账户卡片文字「不加粗」→ 名称 / 套餐用量行 / 用量标签 / 用量数值 / 百分比 统一 400（已随本批推送）

用户 2026-09-16 预览评论（逐元素给了元素路径，原话均为「**不加粗**」）：

- `span.account-card-name`「admin@corp.netease.com」
- `span.account-usage-label`「API 余额」（`.account-usage-row` 内那个）
- `span.account-usage-value-text`「¥6,800.00」
- `span.account-usage-percent`「76%」
- **追加授权（同日）**：`span`「套餐用量」（`.account-usage-title` 里无 class 的子 span）也是「不加粗，改完直接推送」 —— 即把上一版列的残留一并收掉。

口径 = 账户卡片的名称与用量文字不再用字重分层，一律 regular 400。

### 改前 → 改后（桌面端 `[data-host="desktop"]` 计算值，用例 `desktop-full` 1440×900，深/浅同值）

| 元素                                                                    | 改前 | 改后    | 盒尺寸 / 位置                             |
| ----------------------------------------------------------------------- | ---- | ------- | ----------------------------------------- |
| `.account-card-name`（账户邮箱，14px）                                  | 500  | **400** | `153x17 @52,865` 逐值不变                 |
| `.account-usage-title`（套餐用量行，含「套餐用量」span 与 `76%`，12px） | 500  | **400** | `231x17 @14,789` 逐值不变                 |
| `.account-usage-row .account-usage-label`（API 余额，12px）             | 500  | **400** | `47x17 @14,826` 逐值不变                  |
| `.account-usage-row .account-usage-value-text`（¥6,800.00，12px）       | 500  | **400** | 宽 `60 → 58`，**右缘 221 不变**（右对齐） |
| `.account-usage-percent`（76%，12px）                                   | 500  | **400** | 宽 `26 → 25`，**右缘 245 不变**（右对齐） |
| 对照 · `.account-usage-bar`（进度条，未点名）                           | 400  | 400     | `231x6 @14,812` 逐值不变                  |

实现：这些选择器原在 **② 界面标题类（500）** 组，本轮**移出**并新增 **⑨ 组**（`font-weight: var(--cc-font-weight-regular, 400)`，带逐条评论依据注释）；`host-desktop.css` ② 组注释同步说明移出。「套餐用量」这四个字本身没有 class（继承行容器），故 400 落在 `.account-usage-title` 行上。base `AccountCard.css`（`.account-card-name` 500、`.account-usage-title` 500、`.account-usage-percent` 500、`.account-usage-row` 内标签与金额 500）**不动**——该组件仅桌面侧栏使用，但按 0904 约定桌面值一律落在 host 覆盖层。

### 实测

- 计算值：五条 `500 → 400` 全命中（含追加授权的套餐用量行），浅色档同值；对照项 `.account-usage-bar` 未动。
- 几何：用量数值与百分比在行内**右对齐**，字重变细后盒宽各收 2px / 1px，**右缘逐值不变**；套餐用量行与卡片总高逐值不变；卡片内其余元素未动。
- `0 pageerror`；裁剪图 `acc-{dark,light}-{before,after}.png`（`494×240` @DPR2）差异像素均 **6.26%**，bbox `(16,35,477,215)` 只落在卡片文字区。

### 残留（未授权，供后续点名）

- 契约冲突：skill `references/design-system.md:161`（Labels 套餐用量 / API 额度 `12px / 500`）、`:162`（`48%` 说明 `12px / 500`）、`:163`（额度行右侧金额 `12px / 500`）仍写 500 —— 本轮已作为 **W-30** 写进交接单，交 codex 裁决（改条款 or 记为桌面宿主例外）。
- 账户卡其余仍 500 的文字（套餐余量提示等）未点名 → 触发语 **「账户卡其余文字也一起」**。

### 验证脚本与证据

- 脚本：`CC02/probe-accountcard-font-0916.mjs`（同页回退对照 + 深/浅双主题 + DPR2 裁剪图）。
- 证据目录 `CC02/走查/0916-字重/`：`acc-{dark,light}-{before,after}.png`、`acc-verify.json`、`acc-verify.md`。
- 纯 CSS 字重改动（无 TS），未跑 type-check。

### 并行窗口说明

本轮 hunk（`host-desktop.css` ② 组缩减 + 新增 ⑨ 组）与同文件内另一窗口在途改动不重叠；推送时仍用分离索引只取本窗口 hunk，共享索引里他窗口已暂存的内容保持原样。

---

## 0916 评论④：权限下拉菜单内边距 8px → 4px —— **试做后用户撤回，未采用（代码已还原）**

用户 2026-09-16 预览评论（元素 `button.permission-mode-select.mode-default`「修改前询问」）：「下拉菜单的内边距改为 4px，我先看看效果」。我按此试做并给了前后对照（**未提交**），她看过后回复「**还是不改了**」→ 改动**全部还原**，`host-desktop.css` 与撤回前逐字节一致（该文件当前无本轮 diff）。

留档（供以后判断，避免重做）：菜单是 `width:164px` + `box-sizing:border-box` 的**上展开**菜单，`padding: 8px → 4px` 的实际效果 = **外框宽度不变** `164px`、菜单总高 `130 → 122`（底边固定、顶边上移 8px）、选项底色块 `146 → 154` 宽（左缘 1273 → 1269）；触发按钮 `112x32` 与其余属性逐值不变，深/浅两档一致、0 pageerror。

- 探针与截图（保留作证据）：`CC02/probe-permissionmenu-pad-0916.mjs`、`CC02/走查/0916-权限菜单内边距/menu-{dark,light}-{before,after}.png`、`menu-verify.json`。
- 若以后再提：其他下拉菜单内边距仍是 8px 档（触发语「所有下拉菜单内边距都改 4px」）；契约 `references/design-system.md:116` 写的就是容器 `8px padding`，**撤回后无需任何 skill 回写**。

### 并行窗口说明

撤回后本窗口在 `host-desktop.css` **零残留**（只剩另一窗口在途的账户热区 hover 改动 `:746-797` 与 `docs` 里他们的小节），本批无需提交。

---

## 0916 评论⑤：权限下拉项「图标 → 文案」间距 10px → 8px（与其余桌面下拉统一）（已随本批推送）

用户 2026-09-16 预览评论（元素 `li.permission-mode-item.mode-default.selected`「修改前询问」）：「**检查图标到文案之间的间距是 8px 吗**」→ 先审计（只测不改），结论 **不是 8px，实测 10px，且是桌面端唯一的 10px**；她随即指示「**要统一成 8px**」→ 本轮改正。

### 审计读数（`desktop-full` 1440×900；浅/深一致）

| 下拉项                                  | 文案          | computed gap | 图标盒  | 图标右缘 → 文案左缘（实测像素）             |
| --------------------------------------- | ------------- | ------------ | ------- | ------------------------------------------- |
| **权限下拉 `.permission-mode-item`**    | 修改前询问    | **10px**     | `16x16` | **10.0**（图标 `1281→1297`，文案起 `1307`） |
| 账户更多 `.more-menu-item`              | 设置          | 8px          | `16x16` | 8.0                                         |
| 会话行菜单 `.desktop-session-menu-item` | 并排打开      | 8px          | `15x15` | 8.0                                         |
| 工作目录 `.desktop-workdir-menu-item`   | CC02/Users/a… | 8px          | `16x16` | 8.0                                         |
| 加号菜单 `.plus-menu-item`              | 上传文件      | 无图标       | —       | 不适用                                      |
| 快捷指令列表 `.slash-command-item`      | /clear…       | 无图标       | —       | 不适用                                      |

项内衬全部为 `0 8px`，故差异纯粹来自 `host-desktop.css` 的 `.permission-mode-item { gap: 10px }`；契约 `references/design-system.md` **未规定**菜单项「图标→文案」间距（只规定容器 `8px` padding、项高与圆角），无契约冲突。

### 改前 → 改后（计算值 + 像素实测）

| 指标                        | 改前                 | 改后                                        |
| --------------------------- | -------------------- | ------------------------------------------- |
| `.permission-mode-item` gap | `10px`               | **`8px`**                                   |
| 图标右缘 → 文案左缘（实测） | `10.0px`             | **`8.0px`**                                 |
| 文案左缘 / 右缘             | `1307` / `1378.4`    | `1305` / `1376.4`（整体左移 2px，字宽不变） |
| 图标左/右缘                 | `1281` / `1297`      | `1281` / `1297` **逐值不变**                |
| 项盒 / 菜单外框             | `146x28` / `164x130` | `146x28` / `164x130` **逐值不变**           |
| 其余五个下拉项              | `8px`                | `8px` **未动**                              |

实现：`host-desktop.css` 的 `[data-host="desktop"] .permission-mode-item`：`gap: 10px` → `gap: 8px`（上方补 0916 评论⑤ 依据注释）。base `MessageInput.css` 不动 → IDE 端不受影响。0 pageerror。

### 残留（未授权，供后续点名）

- 其他「图标 + 文案」组合未纳入本轮（设置页左侧导航项、账户卡折叠按钮、面板页签等）各自维持原值 → 触发语 **「所有图标+文案都用 8」**（需要时我先出读数表）。
- 无图标的两个列表（加号菜单 / 快捷指令列表）不受影响。

### 验证脚本与证据

- 脚本：`CC02/probe-menuitem-gap-0916.mjs`（六个下拉项横向对照：computed gap + 图标/文案盒 + 像素间距）。
- 证据目录 `CC02/走查/0916-权限菜单内边距/`：`gap-{light,dark}-{before,after}.png`（只裁菜单前两项，便于看间距差）、`gap-verify.json`。

### 并行窗口说明

本轮代码只有 `host-desktop.css` 的 1 条 hunk（`gap` 一行 + 注释 3 行），与同文件内另一窗口在途的账户热区 hover 改动（`:746-797`）不重叠——但该 hunk 在本窗口提交前，被另一窗口的账户热区 hover 提交 **`0b11e794`** 一并带走（他们的提交同时含我的 `gap: 8px`）；截至本节写入时该提交仍在本地未推送（远端 tip `dea19a19`）。本节（docs 记录）由本窗口单独提交，docs 里另一窗口的账户热区小节已随 `0b11e794` 入库、本窗口未改动其内容。

## 0916 拖拽分隔线统一：面板分隔条 / 行分隔条 → 2px 中间深两端浅的渐变线（评论「类似的地方都一起改掉」）（已随本批推送）

用户 2026-09-16 预览评论（承接第 1 轮的拖拽分隔线）：先问「`div.desktop-pane-separator` … 包含在之前的拖拽线优化里吗」→ 审计答复「没有包含」（审计页 Artifact https://codechat.codewave.163.com/code/artifact/xo2nsgzavy ）→ 用户随即指示 **「类似的地方都一起改掉」**。口径 = 与第 1 轮完全同档，只改可见线，**命中区与交互零改动**。

### 改了哪三条（同一族的拖拽缩放分隔线）

| 位置                       | 元素                      | 本轮                                   |
| -------------------------- | ------------------------- | -------------------------------------- |
| 对话区 ↔ 右侧面板（竖）   | `.panel-slot-drag-handle` | 第 1 轮已改，本次未再动                |
| 面板 ↔ 面板（竖）         | `.desktop-pane-separator` | **本次改**（`DesktopApp.css:1328` 起） |
| 上排面板 ↔ 下排面板（横） | `.desktop-row-separator`  | **本次改**（`DesktopApp.css:1266` 起） |

### 改前 → 改后

| 项                | 改前                                                                                          | 改后                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 可见线            | **5px 命中区整条实色** `background: var(--vscode-focusBorder)`（浅 `#1F2329` / 深 `#A0A5A8`） | `::after` 画 **2px 细线**：竖向线 `linear-gradient(180deg, …)`、横向线 `90deg`，核心实色占 **20%–80%**、两端 **8%** 淡出；静止 `opacity:0`、hover 与 `--active` 为 `1`（120ms 淡入）             |
| 取色              | host 焦点色（浅色偏黑 `#1F2329`）                                                             | 局部变量 `--pane-drag-line: var(--cc-text-secondary, var(--vscode-focusBorder, #007fd4))` —— 桌面端浅 `#6C7076` / 深 `#A0A5A8`（＝第 1 轮 B 档同一颗核心色）；插件端无 `--cc-*` 层时回落原焦点色 |
| 命中区 / 拖拽逻辑 | 5px，`col-resize` / `row-resize`                                                              | **逐值不变**；`DesktopShell.tsx` 的 `handleSeparatorMouseDown` / `handleRowSeparatorMouseDown`、`MIN_PANE_WIDTH`（320）/ `MIN_ROW_HEIGHT` 守卫、`--active` 类**一行未改**（本轮纯 CSS）          |

### 实测（`desktop-full`，1440×900，DPR2，浅/深）

- 线宽（穿过线的像素剖面）：**10 设备像素（5px）整条实色 → 4 设备像素（2px）**；面板之间竖线 `5×900`、两行之间横线 `1180×5`，命中区尺寸与改前一致。
- 渐变（全高/全宽取样，DPR2）：竖线（900px 高）浅 `rgb(240,241,241)` → `rgb(108,112,118)` → `rgb(241,241,242)`；深 `rgb(30,33,34)` → `rgb(160,165,168)` → `rgb(30,32,33)`。横线（1180px 宽）浅 `rgb(241,241,242)` → `rgb(108,112,118)` → `rgb(241,242,242)`；深 `rgb(31,33,34)` → `rgb(160,165,168)` → `rgb(31,33,34)`。
- 三态：静止 `opacity:0`、命中区透明；hover 与拖拽中 `opacity:1` 且 `--active` 类正常出现；`0 pageerror`。
- **交互等价（同页 A/B：注入改前样式后重测拖拽轨迹）**：面板之间（每次右移 12px）面板宽 `603→615→627→639`（每步 +12）；两行之间（每次下移 10px）行高 `460→470→480→490`（每步 +10）—— **改前/改后逐值相同**，浅深一致。

### 残留（未授权，供后续点名）

- `.desktop-pane-dropzone` / `.desktop-pane-drop-indicator`：拖 pane 标题重排时的**放置提示**（半透明虚框 + 2px 插入标记），属「放置」语义非「拖拽缩放」，本轮未动 → 触发语 **「放置提示也改」**。
- 线若嫌细/嫌浅，可整体换档（如核心再深一档或 1px）→ 触发语 **「分隔线用 A / C」**（A = 炭黑核心 `#1F2329`，C = 常规灰 `#565A60`/`#C4C7C9`）。
- skill 回写候选（交 codex 审）：把第 1 轮那条实现陷阱扩成一条**通用条款** ——「拖拽缩放分隔线的命中区宽度决定手感、可视线必须画在伪元素上并独立取色；同一产品内所有同类分隔线（竖 / 横）共用同一档线宽与渐变量，不得出现『命中区即可见线』的整条实色实现」。触发语 **「分隔线通用条款写进 skill」**。

### 验证脚本与证据

- 脚本：`CC02/verify-separators-0916.mjs`（三态计算值 + 同页 A/B 拖拽轨迹 + 全页截图）、`CC02/measure-line-metrics-0916.py`、`CC02/build-separator-evidence-0916.py`、`CC02/build-separator-zoom-0916.py`、`CC02/build-separator-fix-report-0916.py`；审计脚本 `CC02/probe-paneseparator-0916.mjs`、`CC02/shots-both-separators-0916.mjs`。
- 证据目录 `CC02/走查/0916-面板分隔条/`：`crop-{pane,row}-{light,dark}-{old,new}-{hover,drag}.png`、`px-{pane,row}-{light,dark}-{hover,drag}.png`（全页）、`线宽对照-*.png`、`对比-两种拖拽条-{1x,4x}.png`、`verify-0916-separators.json`、`gradient-samples-0916.json`、实施页 `0916-面板分隔条-实施.html`（Artifact https://codechat.codewave.163.com/code/artifact/wfzd1krul8 ）、审计页 `0916-面板分隔条-审计.html`（Artifact https://codechat.codewave.163.com/code/artifact/xo2nsgzavy ）。
- **取证诚实说明**：预览 mock 不跟踪「两行」布局，且它的 `desktopResizePanes` 回包会把布局打回单行 → 行分隔条用 harness 的 `simulateExtensionMessage` 注入一条真实的 `desktopPanes` 宿主消息（`row` 0/1 + `rowHeights [0.5,0.5]`）后测量，组件为真实渲染；另注意 `handleRowSeparatorMouseDown` 在宿主未提供 `rowHeights` 时会**直接 return**（既有逻辑，非本轮引入），故测量必须带 `rowHeights`。
- 本轮纯 CSS（`DesktopApp.css` 两条规则），无 TS 改动。

## 0916 评论（设置页卡片圆角 8px → 12px）（已随本批推送）

**她的评论**（点 `div.settings-card`「AI 回复语言设置 AI 回复时使用的语言（技术术语与代码保…）」）：
「设置里面类似布局这里的圆角是 12px，全局统一修改后补充在交接 skill 中」。

### 改动

- `styles/SettingsPage.css` `.settings-card`：`border-radius: 8px → 12px`（文件头部注释里的「radius 8px cards」口径同步改成 12px）。
- 依据：12px = `--cc-radius-lg`（skill `design-system.md:116` 的「弹层 / 容器」口径），与本页弹窗 `.settings-modal`（同文件 `:1223` 已是 12px）同档。
- **「全局统一」的覆盖面 = 设置页唯一的卡片容器类 `.settings-card`**：`全局设置`（AI 回复语言 / 主题选择 / 服务端配置占位 3 张）、`个性化`（`.settings-card.agents-card` + `.settings-card.memory-card`）、`项目设置`（1 张）；插件市场 / 技能 / 子代理 / 钩子 / MCP 服务视图本来就没有卡片容器（列表是行、无描边）。
- 卡内控件圆角**未动**：导航项 8px（桌面宿主）/ 下拉与文本域 6px / 开关 20px / 行按钮 8px、保存按钮 6px。

### 实测（`desktop-full` → 输入框敲 `/config` 回车进设置页，1440×900，DPR2，浅/深）

- 三张卡片 `border-top-left-radius`：**8px → 12px**（浅深逐值一致）。
- 卡片盒（宽 × 高）**逐值不变**：`712x176`（AI 回复语言）/ `712x169`（主题选择）/ `712x46`（服务端配置占位）—— 只改角，不动行高与内距。
- 控件圆角（改后）：`.settings-nav-item` 8px、`.settings-select` 6px、`.settings-number-input` 6px、`.settings-switch-slider` 20px、`.settings-save-btn` 6px。
- `0 pageerror`。
- 证据：`CC02/走查/0916-设置卡片圆角/card-{light,dark}-{before,after}.png`（单卡裁剪 DPR2）+ `page-{light,dark}-{before,after}.png`（整页）+ `card-verify.json`。

### 作用域说明（IDE 宿主）

本条写在共享的 `SettingsPage.css`（不是桌面覆盖层）→ **IDE 宿主（VS Code / JetBrains）的设置页同步生效**。设置页是共享视觉、卡片圆角属产品基线而非桌面特性，故按基线处理；若只允许桌面改，需改为 `host-desktop.css` 覆盖承载 → 触发语 **「卡片圆角只在桌面改」**。

### 残留（未授权，供后续点名）

- `.settings-project-card`（同文件 `:714`，6px「项目分组卡片」）**是死代码**（全 `src` 无 TSX 引用）→ 本轮未动；触发语 **「项目分组卡片也用 12」**。
- 弹窗选项卡 `.settings-scope-option`（8px）、分段轨道 `.settings-modal-seg`（8px）、列表行 `.settings-plugin-row`（8px）属控件 / 行，不在「卡片容器」范围内 → 触发语 **「弹窗选项卡也用 12」**。
- skill 回写候选（交 codex 审）：契约 `design-system.md:34`「Content panel radius: 8px」与 `management-surfaces.md:18`「content panels … 8px radius」与本轮「设置页卡片容器 12px」冲突，已写入交接单 **W-31**（含逐字现文 / 两种建议改法 / 验收口径）。

### 验证脚本与证据

- 脚本：`CC02/probe-settingscard-radius-0916.mjs`（同页回退对照 + 卡片与控件计算值 + 逐视图容器盘点 + 浅深裁剪图）。运行需拷到 `/tmp/pw-0916/`（`playwright-core` 装在那里）。
- 探针坑：分屏用例下页面同时存在**两个 `contenteditable`**（另一个在隐藏 pane，盒 `0×0`）→ 取输入框必须用 `[contenteditable="true"]:visible`，否则会一直等到超时。
- 本轮纯 CSS（`SettingsPage.css` 两条规则 + 头注一行），无 TS 改动。

## 0916 评论（右侧面板操作按钮圆角统一 8px）（已随本批推送）

**她的评论**（点 `button.preview-pane-button`「刷新」，预览面板工具条第 2 颗）：**「类似这种操作按钮圆角统一8px」**。

### 改动

- `packages/webview/src/styles/host-desktop.css`：新增一条规则（写在既有 `.preview-pane-button` 桌面覆盖块之前，含逐字依据注释）：

  ```css
  [data-host="desktop"] .preview-pane-button,
  [data-host="desktop"] .desktop-panel-tabs-add {
    border-radius: var(--cc-radius-md, 8px);
  }
  ```

- 覆盖面（本族 = 24×24 方形图标操作按钮）：四类右侧面板工具条按钮（刷新 / 选择元素并评论 / 在浏览器打开 / 搜索文件 / 重启终端）、tab 条的「全屏」与「＋ 新建面板」、错误态文字按钮（重新加载 / 重启终端 / 重试，同一 class、`width:auto`）。
- 改前两档并存：图标按钮 base `4px`（`DesktopApp.css:1162`）、「＋」`6px`（`DesktopPanelTabs.css:130`）；而同一条 tab 上的页签是 8px、工具行控件 8px（0916 第 3 轮）→ 统一到 `--cc-radius-md`。
- 只改圆角：尺寸 24×24 / 图标 16px / 内衬 0 / 常态透明 / hover 底 / 字色 / hover·active·交互全部未动。

### 实测（临时用例 `tmp-panels-0916`，1440×900，DPR2，浅/深）

- 5 颗：`4px`（4 颗）/ `6px`（「＋」）→ **`8px`**；盒 `24×24`、图标 `16×16`（「＋」13×12）逐值不变；hover 底浅 `#EEF0F3` / 深 8% 白逐值不变。
- 同 class 其余实例（非激活 tab / 错误态，逐条核 computed）：`file-pane-search-trigger`、`diff-refresh`、`terminal-restart`、`terminal-retry`(78×24) 全部 **8px**。
- 像素差异（hover 态，72×72 裁切 = 按钮 48×48 设备像素 + 12px 留白）：单颗 **237（浅）/ 254（深）像素**（4.57% / 4.90%，全部落在四角弧），「＋」181 / 195（3.49% / 3.76%）；整条工具条 0.19%、整条 tab 条 0.14%。`0 pageerror / 0 console error`。
- **静止态看不到任何差异**：这些按钮常态是透明底、无边框 → 圆角只在 hover 出底色时可见，故所有对照图都取 **hover 态**（与 0916 第 3 轮同类坑一致）。

### 取证方式（本轮新增三条坑）

- `.preview-pane-button` 只存在于右侧面板，而 8899 原型默认把面板开不出来（扫全部 17 个用例命中 0 处）→ 新增临时用例 `prototype/mock/tmp-panels-0916.ts`（`desktop-full` 单 pane + 4 条 `desktopTogglePanel` 依次打开 file/diff/terminal/preview，预览最后开 = active）；`mock/` 目录 gitignore、不进推送集。
- 坑 ①：**双 pane 时新面板过不了 `ensurePanelSpace` 空间守卫**（必须单 pane，否则面板一直不开）；坑 ②：**隐藏 tab 里的按钮 `boundingBox()` 返回 null**（须按可见按钮反查父工具条取裁剪区）；坑 ③：对话头部「面板开关」被原型预览层的主题开关遮住、hover 被拦截（残留项降级为只读静止态）。
- **「改前」用同面注入旧值还原（4px / 6px）而非 `git stash`**：本轮只动 `border-radius` 一条属性，注入法在像素上等价，同时避免把并行窗口在途改动一起带走。

### 残留（未授权，供后续点名）

- `.preview-tab-close` 页签关闭「×」`16×16` **3px**（8px ≈ 短边 60%、近圆）→ 触发语 **「页签关闭也统一 8」**。
- `.header-button.header-panel-toggle` 对话头部「面板开关」`24×24` **4px** → 触发语 **「头部按钮也一起」**。
- `.desktop-pane-close` 对话 pane 头部关闭按钮（本轮 mock 未渲染、未核）→ 触发语 **「pane 头部关闭也一起」**。
- `.desktop-session-more-btn` 会话行「更多」`24×24` **6px** → 触发语 **「会话行更多按钮也统一 8」**。

### 验证脚本与证据

- 脚本：`CC02/probe-pane-button-radius-0916.mjs`（computed 读数 + hover 态 1:1 裁切 + 6× 放大 + 差异像素图）、`CC02/build-pane-button-radius-0916.py`（自测页）。
- 证据目录 `CC02/走查/0916-面板操作按钮圆角/`：`measure.json`、`{tag}-{theme}-{before,after}-hover.png`、`zoom-{tag}-{theme}-{before,after}.png`、`diffmap-*`、`toolbar-{theme}-{before,after}-hover.png`、`tabbar-*`，自测页 `0916-面板操作按钮圆角-修复自测.html`（Artifact https://codechat.codewave.163.com/code/artifact/z8pzpxevzk ）。
- 本轮纯 CSS（`host-desktop.css` 一条规则），无 TS 改动。

## 0916 评论（行内说明色与其余说明统一：去掉 hint 上的 opacity 0.75）（已随本批推送）

**她的评论**（点 `p.settings-row-hint`「全局默认；当前模型自带上下文上限时以模型配置为准」）：
「这里用了不一致的字体颜色，和其他说明保持一致」。

### 改动

- `styles/SettingsPage.css` `.settings-row-copy .settings-row-hint`：**去掉 `opacity: 0.75`**（颜色声明本来就是 `--vscode-descriptionForeground`，与其余说明同一颗 token，只是被那层透明度压淡了）。注释同步改写为「说明档差异只保留字号行高（12/20 对正文 14/22）」。
- 依据：桌面宿主在 `host-desktop.css:190` 把 `--vscode-descriptionForeground` 映到 `--cc-text-secondary`，故「同色」只在透明度上是差异；契约也是同一条原则——`design-system.md:151`「keeps the semantic color at full opacity … (not dimmed)」、`:107`（不得再乘一层 opacity）、`conversation-surfaces-desktop.md:16`（不能用整行 opacity 降文字对比）。
- 影响面：`.settings-row-hint` 全族（AI 回复语言 / 上下文长度 / 个性化 / 记忆等 8 处「由组织配置管理」「全局默认；…」等行内说明）统一变回到说明档本色，不再比同级说明更淡。

### 实测（`desktop-full` → 敲 `/config` 进设置页，1440×900，DPR2，浅/深）

| 主题 | 元素                                       | 声明色    | 修复前（实际渲染 / 对比度）          | 修复后               |
| ---- | ------------------------------------------ | --------- | ------------------------------------ | -------------------- |
| 浅   | `.settings-row-hint`                       | `#606060` | `opacity .75` → **#888888 / 3.56:1** | **#606060 / 6.29:1** |
| 浅   | 同级说明（`.settings-row-copy p` 等 6 处） | `#606060` | #606060 / 6.29:1                     | 同值（未动）         |
| 深   | `.settings-row-hint`                       | `#A0A5A8` | `opacity .75` → **#7C8183 / 4.7:1**  | **#A0A5A8 / 7.49:1** |
| 深   | 同级说明（6 处）                           | `#A0A5A8` | #A0A5A8 / 7.49:1                     | 同值（未动）         |

- 改后设置页内 12px 说明文字的渲染色**全部同族**（浅 #606060 / 深 #A0A5A8），对比度浅 6.29:1、深 7.49:1；卡片盒 / 行高 / 字号未变；`0 pageerror`。
- 证据：`CC02/走查/0916-说明文字色/hint-{light,dark}-{before,after}.png`（评论所在行的裁剪图）+ `hint-verify.json`（逐元素 声明色 / 透明度 / 叠加卡面后的实际渲染色 / 对比度）。

### 残留（未授权，供后续点名）

- `.settings-number-input::placeholder`（同文件 `:403`，同款 `opacity: 0.75`）：**占位符**语义（「未设置」的灰字占位，弱于输入值本身），本轮未动；且它的注释写「与同行的说明文字/单位同色」与实际不符（叠了 0.75 后比说明更淡）→ 触发语 **「未设置占位符也和说明同色」**。
- 禁用态 `.settings-select:disabled` 一族 / `.settings-switch input:disabled + .settings-switch-slider`（`opacity 0.6 / 0.55`）属**不可用状态**降档，不是文字色不一致，不在本条范围 → 触发语 **「禁用态也一起提亮」**（不推荐，禁用态需要与可用态区分）。
- skill 回写候选（交 codex 审）：契约已有「语义色不叠额外 opacity」的三处先例（`design-system.md:151` 关闭按钮 / `:107` scrollbar fill / `conversation-surfaces-desktop.md:16` 表格），但**没有把它写成文字角色的通用条款**，以致本处把「弱化说明」实现成了「同一 token 再乘 0.75」。建议补一条通用条款（见交接单 **W-32**）。

### 验证脚本与证据

- 脚本：`CC02/probe-settingshint-color-0916.mjs`（同页回退对照 + 全页 12px 说明文字盘点：声明色 / opacity / 叠加卡面后的实际渲染色 / 对比度 + 评论行裁剪图）。运行需拷到 `/tmp/pw-0916/`（`playwright-core` 装在那里）。
- 本轮纯 CSS（`SettingsPage.css` 一条规则 + 注释），无 TS 改动。

## 0916 评论（tab 选中高亮条：下两角直角、上两角不变、高度不变）（已随本批推送）

**她的评论**（点 MCP 视图的 `button.settings-tab.is-active`「用户级 MCP」）：
「调整 tab 选中高亮条的样式，左下右下圆角是 0，上面不变，高度不变」。

### 改动

- `styles/SettingsPage.css` `.settings-tab.is-active::after`：`border-radius: 999px` → **`1.5px 1.5px 0 0`**。
- 依据：原值 999px 在 3px 高的盒上被浏览器「圆角收缩」折算成 **1.5px**（= 高的一半，四角胶囊、两端半圆头）。要高亮条下缘成一条直线并与 tab 条自身的 1px 分隔线平齐，只把下两角归零、上两角保持折算后的真实值。
- 高度 3px、`bottom: -1px`、`background: --vscode-foreground`、宽度（`left/right: 0`）**全部未动**；只改圆角一条声明。
- 覆盖面：设置页公共 tab（MCP 用户级/项目级/插件、技能、子代理、钩子、规则范围、来源范围、插件市场）——它是共用组件，非单视图覆盖。

### ⚠ 踩坑（第一版写错，已修正，留档避免重做）

第一版写的是 `border-radius: 999px 999px 0 0`（想「上角沿用 999px」）——**错**：CSS 圆角收缩规则按每条边两侧圆角之和判断，左侧和 = 999 + 0 = 999 仍远大于盒高 3px，收缩系数变成 `3/999`，上两角被放大到 **3px**（顶角明显变圆）。实测顶行像素差 100+（浅色左上角 `32` → `228`）。**必须写折算后的真值 `1.5px`** 才满足「上面不变」。

### 实测（`desktop-full` → 敲 `/mcp` 进 MCP 视图，1440×900，DPR2，浅/深）

- 计算值：`radius` `999px` → `999px 999px 0px 0px`（BL/BR 0、TL/TR 保持），`height` 3px、`bottom` -1px、`background` 浅 `rgb(32,32,32)` / 深 `rgb(229,231,232)`、tab 盒 `81x46`、tab 条 `266x59` + `border-bottom: 1px solid` **逐值不变**。
- **像素级 diff（同页回退对照，DPR2）**：差异包围盒 = `(48,27) → (210,30)`，即**只有高亮条底部 1.5px 的圆角区**共 **10 个设备像素**；顶行 `y=24` 剖面**逐像素全等**（浅色左上角两侧同为 `234`，深色同为 `37`）→ 满足「上面不变」。
- 底部左端剖面（浅色，底行 `y=29`）：`x=48` `209 → 32`、`x=49` `103 → 32`、`x=50` `50 → 32`（半透明的圆角渐隐 → 实色直角）；右端 `x=207/208/209` 同理由 `50/103/209` → `32`。深色同构（`168/164/212` → `229`）。
- `0 pageerror`。
- 证据：`CC02/走查/0916-tab高亮条/bar-{light,dark}-{before,after}.png`（活跃 tab 下半部裁剪）+ `strip-*.png`（整条 tab 条）+ `zoom-bar-*.png`（6× 放大）+ `对比-tab高亮条-{light,dark}.png`（前后并排）+ `corner-pixels.json`（四角像素采样 + 差异行统计）。

### 残留（未授权，供后续点名）

- 高亮条颜色仍是 `--vscode-foreground`（浅 `#202020` / 深 `#E5E7E8` 直线），粗细 3px 未动 → 触发语 **「高亮条改 2px / 换主色」**。
- 插件市场视图的 tab 条有滚动覆盖（`overflow-x: auto` + 隐藏滚动条 + 焦点环内移），本轮未动；该视图 tab 与 MCP 同组件，高亮条样式已随之生效。
- 可复用实现陷阱（建议沉淀）：**「3px 高亮条改单侧直角时必须写折算后的真值，不能写 `999px 999px 0 0`」**——已记入本文件，是否写进交接单（新增 W-33：`common-components.md` 的 tabs 条款补一句「下划线 / 高亮条的圆角按其盒高折算后书写，避免 CSS 圆角收缩把上角放大」）**等她点名** → 触发语 **「tab 高亮条圆角写进 skill」**。

### 验证脚本与证据

- 脚本：`CC02/probe-settings-tab-underline-0916.mjs`（同页回退对照 + 伪元素 `::after` 计算值 + 活跃 tab 裁剪）、`CC02/build-tab-underline-evidence-0916.py`（四角像素采样 + 逐行/逐列剖面 + 6× 放大 + 并排对比图）。运行 JS 需拷到 `/tmp/pw-0916/`（`playwright-core` 装在那里）。
- 本轮纯 CSS（`SettingsPage.css` 一条规则 + 注释），无 TS 改动。

## 0916 评论（操作按钮圆角统一 8px · 第 2 族：侧边栏图标按钮 + 头部 `.header-button`）（已随本批推送）

**她的评论**（连标 4 处）：`button.desktop-sidebar-more-btn`「这里」/ `svg.header-icon`「这里」×2 / `button.header-button`「这里」——
**「再看看类似下面我标注的这些地方也要统一」**（承接上一轮 `button.preview-pane-button` 的「类似这种操作按钮圆角统一8px」）。

### 改动

- `packages/webview/src/styles/host-desktop.css`：
  1. 新增一条规则（写在既有「收起态按钮」块之后，含逐字依据注释）：

     ```css
     [data-host="desktop"] .desktop-sidebar-more-btn,
     [data-host="desktop"] .header-button {
       border-radius: var(--cc-radius-md, 8px);
     }
     ```

  2. 同步把既有 `[data-host="desktop"] .header-collapsed-leading .header-button` 的 `border-radius: 6px` 改为 `var(--cc-radius-md, 8px)`（同一族、否则会 6 与 8 并存；注释同步改写）。

- 覆盖面（本族 = 24×24 方形图标操作按钮）：①侧边栏品牌行 2 颗（收起侧边栏 / 活动，`DesktopApp.css:139` 原 **6px**）②会话头 / pane 头 `.header-button`（base 22×22 r4 `ChatHeader.css:52-58`；面板开关 `.header-panel-toggle` 24×24 `ChatHeader.css:112` 原 **4px**）③收起侧边栏后的头部按钮（原 **6px**）。
- 只改圆角：盒 `24×24`（部分 22×22）、图标尺寸（开关按 24 artboard）、常态透明、hover / active 底、字色、交互全部未动。
- **作用域限 `[data-host="desktop"]`**：IDE / VS Code 宿主共用 `.header-button`、`.desktop-sidebar-more-btn` 这两个 class → 已实测 IDE 用例 `ide-chat` 仍是 `4px`、desktop 为 `8px`，两者互不影响。

### 实测（用例 `desktop-full`，1440×900，DPR2，浅/深，0 pageerror）

- `6px → 8px`：侧栏「收起侧边栏」「活动」（hover 底浅 `rgba(0,0,0,0.12)` / 深 `rgba(90,93,94,0.31)`，逐值不变）；`4px → 8px`：左右两颗 pane 头部「面板开关」（同 hover 底）。
- 激活态可见（有底色，静止即可见圆角）：`活动` `.is-active` 浅 `#FFEBE8` / 深 `color(srgb 0.756863 0.160784 0.180392 / 0.18)`，圆角 `8px`。
- 收起态：`.header-collapsed-leading .header-button`（「展开侧边栏」）`24×24`，hover 底浅 `#EEF0F3` / 深 8% 白，圆角 `8px`。
- 像素差异（hover 态，40×40 CSS 裁切）：单颗侧栏按钮 **200（浅）/ 192（深）像素**（3.12% / 3.00%）、面板开关 **257 / 258**（4.02% / 4.03%）、激活态 200 / 192、收起态 181 / 194；整条侧栏品牌行 `0.06%`、整条 pane 头部行 `0.05%`（只有 hover 中那颗的四角变）。**静止态（透明）前后差异 0 像素**。
- 同族残留现状（本轮未动，已实测）：`.desktop-session-more-btn` 24×24 **6px**、`.desktop-pane-close` 24×24 **4px**、`.toast-close` 20×20 **4px**、`.confirmation-close-btn` 20×20 **4px**、`.preview-tab-close` 16×16 **3px**；已一致未动者：`.desktop-sidebar-new-chat` 8px、`.desktop-workdir-trigger` 8px、面板工具条按钮与「＋」8px（0916 上一轮）。

### 取证方式（两条坑）

- 这族按钮静止态透明无边框 → 圆角只在 hover / active 出底色时可见，故全部对照图取 **hover 态**；**「改前」用探针在同一元素注入旧值（6px / 4px）还原**而非 `git stash`（本轮只动 `border-radius` 一条属性，像素等价，且不带走并行窗口在途改动）。
- 坑 ①：mock 的 toast 浮层正好压在两颗「面板开关」上（`elementFromPoint` 命中 `.toast`）→ 真实 hover 失效；坑 ②：原型右上角的用例浮层（`<select>`）同样压住右侧那颗 → 探针内先移除这两个浮层再 hover（只动探针，不动产品代码）。
- **可复用结论**：`--cc-radius-md` 在 wave 仓库内**只被引用、未定义**（全仓 0 处定义），本族既有规则都靠 `var(--cc-radius-md, 8px)` 的 fallback → 新增规则沿用同一写法，避免「有的读 token、有的写字面量」（是否请 codex 在 skill 侧补 token 定义，待她点名）。

### 残留（未授权，供后续点名）

- `.desktop-session-more-btn` 会话行「更多」`24×24` **6px** → 触发语 **「会话行更多按钮也统一 8」**（上一轮已列出，仍未授权）。
- `.desktop-pane-close` pane 头部「关闭」`24×24` **4px** → 触发语 **「pane 头部关闭也一起」**。
- `.toast-close` / `.confirmation-close-btn` `20×20` **4px** → 触发语 **「toast 关闭也统一」**/「确认弹层关闭也统一」。
- `.preview-tab-close` 页签关闭「×」`16×16` **3px**（8px ≈ 短边 60%、近圆）→ 触发语 **「页签关闭也统一 8」**。

### 验证脚本与证据

- 脚本：`CC02/probe-btn-family-radius-0916.mjs`（computed 读数 + 前后 hover/rest 裁切 + 激活态 + 收起态 + 上下文整条 + 掩掉遮挡浮层）、`CC02/build-btn-family-radius-0916.py`（像素差异统计 + 6× 放大 + 差异图 + 自测页）；另有一次性定位脚本 `CC02/probe-find-0916-btns.mjs`（先确认这些 class 在哪些用例渲染）。
- 证据目录 `CC02/走查/0916-操作按钮圆角/`：`measure.json` + 42 张图（`{tag}-{theme}-{hover,rest}-{before,after}.png`、`sidebar-activity-{theme}-active-*.png`、`collapsed-leading-*`、`strip-sidebar-*`、`strip-paneheader-*`、`zoom-*`、`diffmap-*`），自测页 `0916-操作按钮圆角-第2族-修复自测.html`（Artifact https://codechat.codewave.163.com/code/artifact/yt2cbsxx33 ）。
- 本轮纯 CSS（`host-desktop.css` 一条新增规则 + 一条既有规则的圆角值），无 TS 改动。

## 0916 评论（设置页分节标题与卡片内行标题不再加粗）（已随本批推送）

**她的评论**（两条，同批）：

- 点设置页 `h3`「AI 回复语言」→「下面类似的地方都不要加粗」；
- 点设置页 `h2`「基础设置」→「这里」。

### 改动

- `styles/SettingsPage.css` `.settings-section-heading h2`：`font-weight: 600` → **`var(--cc-font-weight-regular, 400)`**。
- `styles/SettingsPage.css` `.settings-row-copy h3`：`font-weight: 600` → **`var(--cc-font-weight-regular, 400)`**。
- 覆盖面（两类都是设置页公共类，全视图生效）：分节标题 = 全局设置「基础设置 / 桌面端设置 / 服务端配置 / 内置插件 / AGENTS.md / 自动记忆规则」；行标题 = 每个卡片行的 `h3`（AI 回复语言、上下文长度、主题、接收 Beta 版更新、SDD、开启自动记忆、触发记忆提取会话轮次…），以及 MCP / 技能 / 子代理 / 钩子 / 插件市场等视图里同样使用 `.settings-row-copy` 的行。
- 未动项（**不同层级，同批未授权**）：左侧导航分组标题 `.settings-nav-group h2`（500）、页头主标题 `.settings-page-header h1`（600）、插件行名 `.settings-plugin-name`（600）、弹窗标题 `.settings-modal-header h3`（600）、作用域弹窗选项标题 `.settings-scope-option-title`（600）、分段选中态 `.settings-plugin-chip.is-active` / `.settings-modal-seg-item.is-active`（600）。
- 依据：设置页内部层级只靠**字号（14px）+ 位置（分节在卡外、行标题在卡内）**表达即可；加粗在 14px 中文小字号上会让标题与同行说明（12px）抢视觉权重，且与「按钮 500 / 正文 400」的既有口径不同族。

### 实测（`desktop-full` → 敲 `/config`，1440×900，DPR2，浅/深；同页回退对照）

- 字重：全部 `.settings-section-heading h2` 与 `.settings-row-copy h3` 计算值 `600 → 400`（浅/深一致）。
- **几何零位移**：分节标题盒 `712x25`、行标题盒 `300x26 / 294x26 / 261x26 / 135x26`、同行说明 `712x20`；**所有 `.settings-row` 的盒、y、`h3` 文本、右侧控件盒（`宽x高@x`）前后逐值完全相同**（脚本断言 `行盒 / 行高 / 右侧控件列 前后完全一致 = true`，浅/深均通过）。
- 文字宽只随字重微变（浅色：「基础设置」`56 → 57.1`、「AI 回复语言」`73.5 → 73.8`、「上下文长度」`70 → 71.4`、「接收 Beta 版更新」`108 → 108.4`），远小于其容器余量，**无一处换行变化**。
- `0 pageerror`。
- 证据：`CC02/走查/0916-设置标题字重/titles-{light,dark}-{before,after}.png`（分节标题 + 首张卡片前两行的裁剪图）+ `title-weight-verify.json`（逐元素字重 / 字号 / 行高 / 盒 / 裸文本宽 + 全部行盒与控件列对照）。

### 残留（未授权，供后续点名）

- 上述「未动项」里的 600 尚未随本轮收整 → 触发语 **「页头标题也不要加粗」** / **「插件名也不要加粗」** / **「弹窗标题也不要加粗」** / **「作用域弹窗选项标题也不要加粗」**（导航分组 500 → 触发语 **「导航分组标题也统一 400」**）。
- skill 契约口径待 codex 确认：`common-components.md:11` 有「group headings retain their own typography」的保留句，而 `design-system.md:183` 规定页头标题 semibold —— **设置页「分节标题 400」是否属于该保留句的例外情形、要不要显式写入**，本轮只在代码注释里留了提示，未擅自回写 → 触发语 **「分节标题字重写进 skill」**（新增交接单条目）。

### 验证脚本与证据

- 脚本：`CC02/probe-settings-title-weight-0916.mjs`（同页回退对照 + 逐元素字重/盒/裸文本宽 + 全部 `.settings-row` 与右侧控件列对照 + 裁剪图）。运行需拷到 `/tmp/pw-0916/`（`playwright-core` 装在那里）。
- 本轮纯 CSS（`SettingsPage.css` 两条规则 + 注释），无 TS 改动。

## 0916 评论④：账户卡用量区（`.account-card-usage-inline`）字号**统一 12px** + 余额状态文字色绑定审计（**颜色一律不动：两批换色尝试已按她指示全部撤回**）（已提交，待推送）

> **⚠️ 颜色结论（最终态）**：她看过换色对比后指示「这里颜色先不动了」→ 我列出三种理解请她选，她选 **「两批换色全退」**。故本轮**只落地字号一项**，账户卡所有文字色 / 图标色 / 气泡色 / 状态色**与改动前逐字节一致**（`host-desktop.css` 中该区域除下方那一条字号规则外与 HEAD 无差异，`git diff` 已验证）。下方「追加」「追加 2」两节的换色内容**已全部回退，仅作审计留档**，其中状态色绑定审计与对比度实测仍是有效结论（浅色预警琥珀 12px 小字对比度 2.93:1 不达标属历史遗留，仍未处理）。

**她的评论（两步）**：

1. 先点 `div.account-card-usage-inline`「套餐用量 76% / API 余额 ¥6,800.00」→「这里面信息，字号都大一号，除了套餐余量用完的报错提示用 12px 之外」；
2. 撤销 →「还是改回来，都用 12px，然后检查不同余额状态字体颜色是否绑定了全局变量」。

### 改动（`styles/host-desktop.css`，`[data-host="desktop"]` 作用域）

- **字号全部回到 12px**：四段文字（`span` 无类名「套餐用量」/ `.account-usage-percent` / `.account-usage-row .account-usage-label` / `.account-usage-row .account-usage-value-text`）不再有任何字号覆盖 → 走 base 的 12px / `line-height: normal`（中途试过的 14px / 20px 已删除）。
- **仅保留一条**：`.account-usage-exhausted`（「套餐余量已用完，请联系销售人员充值」）`11px`（越档，契约无此档）→ **`12px`**；其 `line-height: 15px` 与盒 231×15 未动，故该行**几何零变化**。
- 未动：ⓘ `.account-api-info-btn` 内嵌 16px SVG（非文字）；进度条 231×6px；**全部文字色与状态配色（见下「颜色」说明）**。

### 实测（`desktop-full` / `desktop-account-plan-exhausted` / `desktop-account-api-low` / `desktop-account-api-empty`，浅+深，1440×900 @DPR2）

- 最终计算值：四段文字全部 `12px / normal`（「套餐用量」49×17、「76%」25×15、「API 余额」47×17、「¥6,800.00」58×15、耗尽态「已用完」37×17）；提示行 `12px / 15px`（盒 231×15）。
- **几何与改动前逐值一致**：用量区 `235×63` 不变，账户卡 `235×108` 不变，耗尽场景 `235×84` / `235×129` 不变，进度条 231×6 不变（改大一号那版的 +6px 已一并撤回）。
- `0 pageerror`（4 用例 × 2 主题全为 `[]`）。

### 余额状态文字色 × 全局变量绑定审计（她第二条指示）

**结论：正常 / 预警 / 耗尽三个状态的文字色全部来自宿主主题变量，无硬编码色值。** 实测（CSSOM 枚举命中声明 + 浅深对照）：

| 角色                  | 浅色                             | 深色                                  | 绑定声明                                                                                                                                            |
| --------------------- | -------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 套餐用量标签          | `rgb(32,32,32)`                  | `rgb(229,231,232)`                    | `var(--vscode-foreground)`（继承自 `.account-usage-title`）                                                                                         |
| API 余额标签          | 同上                             | 同上                                  | `var(--vscode-foreground)`                                                                                                                          |
| 余额金额 · 正常       | `rgb(32,32,32)`                  | `rgb(229,231,232)`                    | 继承 `body` 的 `var(--vscode-editor-foreground)`                                                                                                    |
| 余额金额 · 预警       | `rgb(191,136,3)`                 | `rgb(204,167,0)`                      | `var(--vscode-editorWarning-foreground, #d18616)`（`.account-usage-value.is-warning`）                                                              |
| 余额金额 · 耗尽       | `rgb(173,7,7)`                   | `rgb(248,81,73)`                      | `var(--vscode-errorForeground, #f14c4c)`（`.account-usage-value.is-empty`）                                                                         |
| 用量百分比 · 耗尽     | `rgb(173,7,7)`                   | `rgb(248,81,73)`                      | `var(--vscode-errorForeground, #f14c4c)`                                                                                                            |
| 用完提示行            | `rgb(173,7,7)`                   | `rgb(248,81,73)`                      | `var(--vscode-errorForeground, #f14c4c)`                                                                                                            |
| 进度条填充（正 / 耗） | `rgb(31,35,41)` / `rgb(173,7,7)` | `rgb(154,158,165)` / `rgb(248,81,73)` | `var(--vscode-button-background)` / `var(--vscode-errorForeground)`                                                                                 |
| **用量百分比 · 正常** | `rgb(31,35,41)`                  | `rgb(160,165,168)`                    | ⚠️ 浅色是**字面量 `#1f2329`**（`[data-theme=light] .account-usage-percent:not(.is-empty)`，覆盖 `var(--vscode-descriptionForeground)`）；深色走变量 |

- 宿主变量在预览主题下的解析值：`--vscode-errorForeground` `#ad0707 / #f85149`、`--vscode-editorWarning-foreground` `#bf8803 / #cca700`、`--vscode-descriptionForeground` `#606060 / #a0a5a8`、`--vscode-foreground` `#202020 / #e5e7e8`。
- **另发现 3 处字面量**：① 上述浅色正常态百分比 `#1f2329`；② ⓘ 图标 `.account-api-info-btn` 浅 `#8b8f95` / 深 `#9a9ea5`（hover 走 `var(--vscode-foreground)`）；③ 明细气泡 `.api-quota-popover` 浅色档标题/金额 `#1f2329`、行标签 `#565a60`；另有进度条轨道浅色 `#e6e8eb`（背景色，非文字）。**她先选「浅深都绑 token」→ 前三处曾改绑，随后改判「颜色先不动了」已全部撤回，详见下节「追加」。**
- 三者与仓库已定义的 `--cc-text-*` token 同值（故浅色档改绑零视觉变化）：`--cc-text-primary` = `#1f2329 / #e5e7e8`、`--cc-text-placeholder` = `#8b8f95 / #858b8f`、`--cc-text-regular` = `#565a60 / #c4c7c9`。

### 追加（**已撤回，未采用**）：3 处字面量改绑 cc token（她曾选「浅深都绑 token」，后改判「颜色先不动了」）

> 本节所述改动**已全部回退**（百分比、ⓘ、气泡三处恢复为改动前的字面量 / vscode 变量写法）。保留本节是因为「审计查出的 3 处字面量」与其 A/B 数值仍是有效信息，供后续点名时复用。

审计查出的 3 处字面量已按她选择改绑，**并从「仅浅色档」提升为主题无关声明**（深浅共用一条规则）：

- 用量百分比 `:not(.is-empty)`：`[data-theme=light] #1F2329` → **`var(--cc-text-primary, #1f2329)`**。
- ⓘ 明细图标 `.account-api-info-btn`：浅 `#8B8F95` / 深 `#9A9EA5` 两条 → 一条 **`var(--cc-text-placeholder, #8b8f95)`**。
- 明细气泡：标题 / 金额 → **`var(--cc-text-primary, #1f2329)`**、行标签 → **`var(--cc-text-regular, #565a60)`**（原只有浅色档有字面量，深色走 base 的 vscode token）。
- **字重未动**（气泡金额 500 仍只在浅色档、深色保持 base 400）；状态色（预警琥珀 / 耗尽红）仍走 `--vscode-*` 状态变量。

同页 A/B（同一页面注入「改前声明」逐字回放旧值，布局完全一致）：

| 角色                   | 浅色 改前 → 改后           | 深色 改前 → 改后                            |
| ---------------------- | -------------------------- | ------------------------------------------- |
| 用量百分比 · 正常      | `rgb(31,35,41)` **零变化** | `#A0A5A8` → **`#E5E7E8`**                   |
| ⓘ 明细图标             | `#8B8F95` **零变化**       | `#9A9EA5` → **`#858B8F`**                   |
| 气泡标题 / 金额        | `#1F2329` **零变化**       | `#E5E7E8` **零变化**（原本就等于 token 值） |
| 气泡行标签             | `#565A60` **零变化**       | `#A0A5A8` → **`#C4C7C9`**                   |
| 气泡警示文案（状态色） | 零变化                     | 零变化（未动）                              |

- 深色三处变化的对比度（深色侧栏底 `#181A1B`、气泡底 `#111314`）：百分比 `7.02:1 → 14.08:1`（更醒目）、ⓘ `6.49:1 → 5.06:1`（略退，仍远超图形 3:1 门槛）、气泡行标签 `7.49:1 → 10.97:1`（更清晰）。浅色参考：百分比 14.86:1、行标签（白底）6.94:1、ⓘ 3.06:1（刚好过 3:1，未动）。
- `0 pageerror`；深浅各 2 用例实测。
- **未随本轮改绑**：进度条轨道浅色 `#E6E8EB` —— 仓库无同名 token（`--cc-fill` = `#F0F2F5` 偏浅，绑了会变浅）→ 触发语 **「进度条轨道也绑 token」**（需先定轨道档）。

### 追加 2（**已撤回，未采用**）：余额状态文字色改绑 skill 角色 token（她曾指「我的意思是走桌面端 skill 的变量」，后改判「颜色先不动了」）

> 本节所述改动**已全部回退**：7 处状态色绑定删除，新增的 `--cc-color-warning` / `--cc-color-warning-soft`（浅深两档）也从 token 块移除；状态色回到 `--vscode-errorForeground` / `--vscode-editorWarning-foreground`，与改动前逐字节一致。
> **仍有效的结论**：① 状态色的确全部来自宿主变量、无硬编码（审计表见上）；② 浅色档预警琥珀对 12px 小字对比度不足（`#BF8803` = 2.93:1）属**历史遗留未解决**，若日后处理，skill 处方为「可读文字 + 图标承担状态含义」或另立 state-text 角色，**不得静默调暗全局信号色**；③ skill 角色 token 的映射表与两档取值（下文引文）可直接复用。

依据 = skill 契约（`codechat-desktop-skill` 仓库，非 wave 写法）：
`references/desktop-theme-bridge.md` 映射表 —— `--vscode-editorWarning-foreground → --cc-color-warning`（Warning signal）、`--vscode-errorForeground → --cc-color-danger`（Error/destructive meaning）；取值 = `theme/desktop-colors.css` 两档（warning 浅 `#D97706` / 深 `#E8BF78`，danger 浅 `#DC2626` / 深 `#F19B95`）。

- **wave 侧 `--cc-color-warning` 此前缺失**（只有 success / danger / info）→ 曾按 skill 补齐浅深两档 + `-soft`（`host-desktop.css` token 块；`--cc-color-danger` 等值本就与 skill 逐值一致，未动）。**已随本轮撤回，token 块现与改动前一致。**
- 曾新增 host 层绑定（base `AccountCard.css` 不动，IDE / VS Code 宿主不受影响；回退链 = `cc token → vscode → 原字面量`），覆盖 7 处：`.account-usage-percent.is-empty`、`.account-usage-exhausted`、`.account-usage-value.is-empty`、`.api-popover-amt.is-empty`、`.api-popover-warn.is-empty` → `var(--cc-color-danger, …)`；`.account-usage-value.is-warning`、`.api-popover-warn.is-warning` → `var(--cc-color-warning, …)`。**已删除。**
- 字号 / 字重 / 几何全未动（纯换色）。

同页 A/B（注入改前的 `--vscode-*` 声明回放旧值）：

| 角色                           | 浅色                  | 深色                  |
| ------------------------------ | --------------------- | --------------------- |
| 余额金额 · 预警                | `#BF8803` → `#D97706` | `#CCA700` → `#E8BF78` |
| 气泡警示行 · 预警              | `#BF8803` → `#D97706` | `#CCA700` → `#E8BF78` |
| 余额金额 · 耗尽                | `#AD0707` → `#DC2626` | `#F85149` → `#F19B95` |
| 气泡警示行 / 气泡金额 · 耗尽   | `#AD0707` → `#DC2626` | `#F85149` → `#F19B95` |
| 用量百分比 · 耗尽 / 用完提示行 | `#AD0707` → `#DC2626` | `#F85149` → `#F19B95` |

按实际合成底色实测对比度（12px 属正常文字，门槛 4.5:1）：

- **深色档全部达标且更清晰**：预警 侧栏 `7.56 → 10.11:1`、气泡 `8.07 → 10.78:1`；耗尽 侧栏 `5.21 → 8.20:1`、气泡 `5.56 → 8.75:1`。
- 浅色 danger：`7.04 → 4.55:1`（侧栏）、`7.47 → 4.83:1`（白底）→ 仍达标。
- ⚠️ **浅色 warning 不达标**：改前 `#BF8803` = **2.93:1**（白底 3.12），改绑 skill 值 `#D97706` 后 = **3.00:1**（白底 3.19）→ 仍 < 4.5:1。属**历史遗留**（改前就不达标），本次略升但未解决。skill 明确写了处置原则：_「Existing signal colors are not automatically readable text colors… When a state color fails, use existing primary/regular text for the readable label and retain state meaning through a labelled icon/indicator, or propose a dedicated state-text role with measured Light/Dark pairs. Do not silently darken a global signal color.」_ → **未擅自调暗**，处置方式待她裁决（A 保持 skill 信号色 / B 文案改可读色 + 图标承担状态含义 / C 另立 `--cc-state-text-warning` 角色交 codex 回写）。
- `0 pageerror`（3 用例 × 2 主题 × 静止/悬停）。

### 残留（未授权，供后续点名）

- 气泡内文字仍是 12px（0916 第 6 轮按设计稿 13651:4864 定值）→ 触发语 **「气泡也大一号」**。
- 账户名 `.account-card-name` 已是 14px；字重由「不加粗」那轮处理为 400 → 触发语 **「账户名也一起看」**。
- **颜色相关一律暂停**（她「这里颜色先不动了」）：以下候选均已冻结，需她另行点名才会动 ——
  - 进度条轨道：skill `design-system.md:106` 明确「`--cc-fill-track` **就是**账户用量进度条的轨道色（不是滚动条轨道）」，值 浅 `#EBEDF0` / 深 `#303436`；wave 现为浅色字面量 `#E6E8EB` + 深色 color-mix → 触发语 **「进度条轨道走 fill-track」**。
  - 进度条填充：skill `design-system.md:162` 描述该设计稿「filled `--cc-text-primary`」，wave 现为 `--vscode-button-background`（浅色实测同 `#1F2329`、深色 `#E0E3E5` vs token `#E5E7E8`）→ 触发语 **「进度条填充走 text-primary」**。
  - 用量百分比浅色字面量 `#1f2329`、ⓘ 图标浅深两条字面量、气泡浅色档 `#1F2329` / `#565A60` 三处（审计见上）→ 触发语 **「账户卡那三处字面量还是绑 token」**。
  - 浅色预警琥珀 12px 小字对比度 2.93:1（历史遗留）→ 触发语 **「浅色预警小字对比度」**。

### 验证脚本与证据

- 脚本：`CC02/probe-account-usage-type-0916.mjs <tag>`（4 用例 × 2 主题枚举用量区内所有直接承载文本的节点：computed 字号/行高/字重/颜色/盒 + 裁剪图 + `pageerror` 监听）、`CC02/probe-account-usage-colors-0916.mjs`（枚举命中该节点的全部 `color` 声明，区分 `var()` / 字面量；自身无声明时沿继承链定位上游声明；并读变量实际解析值）、`CC02/probe-usagelink-tokens-0916.mjs`（同页 A/B：先测改后，再 `addStyleTag` 注入改前声明测改前；气泡裁剪框按气泡 rect 计算；ⓘ 的图像色单列静止态采集，避免混入 hover 色）、`CC02/probe-usage-statecolors-0916.mjs`（状态色同页 A/B：静止 + 悬停两相，含气泡警示行/金额）、`CC02/build-account-usage-type-0916.py`（内联图片生成证据页，含按实际底色算的对比度表）。
- 数据与图：`CC02/走查/0916-账户用量字号/{before,final}-0916-usage-type.json`、`colors-0916-usage.json`、`tokens-0916-usagelink-colors.json`、`statecolors-0916-usage.json`、`final-{case}-{theme}.png`、`tokens-{before,after}-{popover,usage}-*-{light,dark}.png`、`对比-用量区字号-{light,dark}.png`（已撤回的 14px 版留档）。
- 证据页（字号表 / 几何表 / 状态色绑定表 / 变量解析值 / 4 状态最终态截图 / §7 cc token 改绑 / §8 skill 状态色改绑 + 对比度；**§7 / §8 已标注「已撤回」**）：`CC02/走查/0916-账户用量字号/0916-账户用量字号-实施.html`（Artifact https://codechat.codewave.163.com/code/artifact/ybcochklxt ）。
- 踩坑：① CSSOM 枚举「分组规则」必须用 `r.selectorText === undefined` 判断 —— 新版 Chrome 的 `CSSStyleRule` 也带（空的）`cssRules`，用 `if (r.cssRules)` 会把所有普通规则整批漏掉；② 采 ⓘ 这类「hover 会变色」的控件时，静止色必须单独在 hover 之前采，注入改前声明时也要带 `:not(:hover)`，否则 A/B 会拿「改前静止色」比「改后 hover 色」；③ **回退换色时并行窗口刚在同一文件提交了新 commit**（`12130ba8`「设置页返回 1 级字色」）→ 不能用 `git checkout` 整文件回退，必须逐段 `Edit` 还原成 HEAD 原文，再用 `git diff` 核对「该区域只剩字号那一条」。
- 本轮落地内容：**纯一条字号规则 + 注释**（`host-desktop.css`），无 TS 改动、无 token 增删、无换色。

## 0916 评论（侧栏「新对话」文案提到 1 级文字色）（已随本批推送）

**她的评论**（点侧栏 `span`「新对话」）：「这里的字体颜色深浅模式都用 1 级的」。

### 改动

- `styles/host-desktop.css` **新增**两条规则（放在「控件图标统一灰」块之后，因为它就是本处被染灰的原因）：
  ```css
  [data-host="desktop"] .desktop-sidebar-new-chat span {
    color: #1f2329;
  }
  [data-host="desktop"][data-theme="dark"] .desktop-sidebar-new-chat span {
    color: #e6e6e6;
  }
  ```
- 根因：第三十八轮的「控件图标统一灰」规则把 `.desktop-sidebar-new-chat` 整颗按钮（含**文案**）一起染成 `#565a60` / `#9a9ea5`；该规则本意只管**图标**。本次只把**文案**提回 1 级。
- 1 级取值依据：与同栏会话行标题 `.desktop-session-item`（`DesktopApp.css:299` 浅 `#1f2329` / `:427` 深 `#e6e6e6`）**逐值相同**；浅色档值同时等于 `--cc-text-primary`。深色档刻意不取 token 的 `#E5E7E8`，而取同一面板既有 1 级值 `#E6E6E6`（差 1~2 通道，避免同栏两处「1 级」不同值）。
- 参考实现同构：`codechat-ui` `components/TaskSidebar.vue` 的 `.sidebar-tool-button` 自身不设色（文字继承 `body` 的 `--cc-text-primary`），图标资源 `assets/figma/new-chat.svg` 单独填灰 `#4E5969` —— 即「**文字 1 级 + 图标灰**」。
- 未动项：图标仍按第三十八轮图标规范留 `#565A60` / `#9A9EA5`；字号 14 / 字重 400 / 盒 235×30 / r8 / gap 8 / 左右内衬 / hover 底色 / 禁用态 `opacity: 0.5` 全部未动。作用域只有侧栏这一颗按钮的文案 `span`。

### 实测（`desktop-full` 首屏，1440×900，DPR2，浅/深；同页回退对照）

| 主题                   | 文案色（修前 → 修后） | 对比度（修前 → 修后） | 与同栏会话行标题同值 | 图标（修前 → 修后）           |
| ---------------------- | --------------------- | --------------------- | -------------------- | ----------------------------- |
| 浅（侧栏底 `#F7F8FB`） | `#565A60` → `#1F2329` | 6.53:1 → **14.86:1**  | ✅                   | `#565A60` → `#565A60`（未动） |
| 深（侧栏底 `#181A1B`） | `#9A9EA5` → `#E6E6E6` | 6.49:1 → **13.99:1**  | ✅                   | `#9A9EA5` → `#9A9EA5`（未动） |

- 几何与交互零变动：按钮盒 `235x30`、`14px`、`r8`、`gap 8px`、文案宽 `42.8px` 前后逐值相同；hover 底色浅 `rgb(238, 240, 243)` / 深 `rgba(255, 255, 255, 0.08)` 前后一致。
- `0 pageerror`。
- 证据：`CC02/走查/0916-新对话文字色/newchat-{light,dark}-{before,after}.png` + `newchat-level1-verify.json`。

### 残留（未授权，供后续点名）

- 该按钮**图标**仍是控件图标灰 `#565A60` / `#9A9EA5`（第三十八轮图标规范 normal 档，且参考实现亦为灰）→ 触发语 **「新对话图标也提到 1 级」**。
- 同一条「图标统一灰」名单里的其余项（`.desktop-sidebar-more-btn:not(.is-active)`、`.desktop-session-more-btn`、`.account-card-more-btn`、`.header-panel-toggle`、`.desktop-pane-close`、`.write-preview-open`、`.toast-close`、`.confirmation-close-btn` 等）都是**纯图标按钮**，本轮未动、也不建议动 → 若要把「侧栏导航项一律 1 级文字」写成通用条款，触发语 **「侧栏文字层级写进 skill」**。
- 左侧分组标题 `.desktop-session-group-name` 仍是次级灰（浅 `#6C7076` / 深 `#9A9EA5`），属分组标签层级，未动 → 触发语 **「分组标题也提到 1 级」**。

### 验证脚本与证据

- 脚本：`CC02/probe-sidebar-newchat-color-0916.mjs`（盘点该按钮/文案/图标/同级会话标题的计算色与对比度）与 `CC02/probe-sidebar-newchat-level1-0916.mjs`（同页回退对照 + 几何/hover/文案宽前后比对 + 裁剪图）。运行需拷到 `/tmp/pw-0916/`（`playwright-core` 装在那里）。
- 本轮纯 CSS（`host-desktop.css` 两条新增规则 + 注释），无 TS 改动。

## 0916 评论（关闭按钮族：pane 头部 / toast / 确认弹层 / 面板页签）（已随本批推送）

**她的三条指示**（承接上一轮残留清单）：
①「pane 头部关闭也一起」②「页签关闭仅图标变色，不要背景色也不用圆角了」③「toast 关闭 / 确认弹层关闭应该是和 pane 头部关闭用同一个图标，同样的圆角」。

### 改动

- `packages/webview/src/styles/host-desktop.css`（一侧新增「关闭按钮族」块，另改两处既有规则）：
  - 新增：`[data-host="desktop"] .desktop-pane-close, .toast-close, .confirmation-close-btn { border-radius: var(--cc-radius-md, 8px) }`（**4px → 8px**，三个按钮）。
  - 新增：`[data-host="desktop"] .toast-close { width: 20px; height: 20px; padding: 0 }` + `… .toast-close-icon, … .confirmation-close-btn-icon { flex-shrink: 0 }` —— 图标换成 24 artboard 后，20 的按钮盒会把 svg 压成 20×24（实测 computed），字形被缩到 0.83 倍；加 `flex-shrink: 0` 后保持 24×24 居中溢出，字形与 pane 头部关闭**逐像素同尺寸**。
  - 新增：`[data-host="desktop"] .preview-tab-close { border-radius: 0 }`（**3px → 0**）+ `… .desktop-panel-tab .preview-tab-close:hover { background: transparent }`。
  - 改既有：`[data-host="desktop"] .confirmation-close-btn` 里的 `border-radius: 4px` → `var(--cc-radius-md, 8px)`（同选择器同特异性，不改这处会被先前定义覆盖）。
  - 改既有：把「add / 全屏 / close hover 统一 fill-hover」规则里的 `.preview-tab-close:hover` 选择器摘掉（只留 `＋` 与全屏），否则页签关闭的 hover 底去不掉。
- `packages/webview/src/components/ToastStack.tsx`、`ConfirmationDialog.tsx`：关闭图标按宿主选择 —— 桌面端用 `ConversationCloseIcon`（= pane 头部关闭那颗，Figma 关闭 13440:12465），其余宿主保持 `CloseIcon`（`isDesktopHost()`，见 `utils/platform.ts`）。

### 实测（`desktop-full` + 临时用例 `tmp-panels-0916`，1440×900 @DPR2，浅/深，0 pageerror）

- 圆角：pane 头部关闭 24×24 `4px → 8px`；toast 关闭 20×20 `4px → 8px`；确认弹层关闭 20×20 `4px → 8px`；面板页签关闭 16×16 `3px → 0`。
- 图标（`path d` 长度可判定）：toast / 确认弹层 `143（16×16 · viewBox 17 17）→ 524（24×24 · viewBox 24 24）`，与 pane 头部关闭同值；**墨迹实测 8.0px → 9.0px**，与 pane 头部关闭的 9.0px 一致（同一官方矢量、同一实际字号）。
- 页签关闭：hover 底 浅 `#EEF0F3` / 深 8% 白 → **透明**；hover 仍只做图标变色（浅 `#565A60 → #1F2329`、深 `#9A9EA5 → #FFFFFF`）。像素差异：深色 hover 裁切 **914 px（17.63%）**（底色整块消失）、浅色仅 **7 px（0.14%）**（浅色下 `#EEF0F3` 与 tab 底几乎同色，去掉后几乎看不出——如实记录）；静止态 0 px。
- hover 态像素差异（40×40 CSS 裁切）：pane 头部 257 / 258（3.32% / 3.33%，只四角弧）、toast 359 / 363（5.61% / 5.67%）、确认弹层 309 / 328（4.83% / 5.12%）；静止态 toast / 确认弹层 74~101 px（就是 × 形变化）。
- **几何零变化（逐值复核）**：toast 整条 `452×46`、确认弹窗 `589×226`、pane 头部行 `589×44`、头部按钮组 `52×24`、四个按钮盒 `24 / 20 / 20 / 16` —— 前后一致。
- **宿主分叉实测**：在 desktop 用例里把 `window.waveHostType` 改成 `"ide"` 再发一条 toast，重渲染后所有 toast 关闭的 `path d` 从 524 变回 **143** → 分叉是活的，真实 IDE / VS Code 宿主保持原 `CloseIcon`（mock 的 `ide-chat` 用例本身不渲染 toast / 弹层，故用同页切标记取证，非 IDE 截图）。

### 取证方式

- **改前是真实构建**：把本轮三个改动文件备份到 `/tmp/0916close-backup/`、`git checkout --` 回 HEAD 采 before，再原样还原（md5 逐值校验 `de940bfd…` / `5b270f99…` / `269a0463…`）采 after —— 图标形变化与 hover 底消失都是真截图对比（上一轮只动圆角时用的是同面注入法，本轮不适用）。
- 坑 ①：页签关闭「×」默认 `visibility:hidden`，必须先 hover 所在 tab 才显形；它的「静止态」要把指针停在 tab 左缘（仍算 tab hover、但不在 × 上），否则截到空白。
- 坑 ②：mock 的 toast 浮层会压住 pane 头部关闭（`elementFromPoint` 命中 `.toast`），取该目标前先移除 toast。
- 坑 ③：20 的按钮盒 + 24 的 svg 会被 flex 压成 20×24（字形等比缩到 0.83），必须 `flex-shrink: 0` 才能与 pane 头部逐像素同尺寸。

### 残留（未授权，供你点名）

- toast / 确认弹层关闭按钮盒仍 20×20（pane 头部是 24×24）→ 触发语 **「关闭按钮盒也统一 24」**。
- 页签关闭 hover 仍带 `opacity 0.6 → 1`（明度变化，非颜色）→ 触发语 **「页签关闭的 hover 只留变色」**。
- 本轮按 desktop 作用域处理，IDE / VS Code 宿主的 toast・弹层关闭仍用旧 `CloseIcon` → 触发语 **「关闭图标全宿主统一」**。
- toast 右侧关闭在顶部栈的 hover 底是 `color-mix(currentColor 14%)`，与圆角 8px 不属同一套 token → 触发语 **「toast 关闭 hover 底接 fill-hover」**。

### 验证脚本与证据

- 脚本：`CC02/probe-close-buttons-0916.mjs`（`PHASE=before|after`，computed 读数含图标 viewBox / `path d` 长度 / 墨迹依赖的 rect + 裁切图）、`CC02/build-close-buttons-0916.py`（差异像素 + 墨迹 bbox + 6× 放大 + 差异图 + 本页）、`/tmp/gate-check-0916.mjs`（宿主分叉验证）。
- 证据目录 `CC02/走查/0916-关闭按钮族/`：`measure-{before,after}.json`、`{key}-{theme}-{rest,hover}-{before,after}.png`、`zoom-*`、`diffmap-*`、`gate-check-desktop-vs-ide.png`，自测页 `0916-关闭按钮族-修复自测.html`（Artifact https://codechat.codewave.163.com/code/artifact/wjwh6vzelp ）。
- `pnpm -F wave-webview type-check` 通过（本轮含 2 个 TSX 改动）。

---

## 0916 评论（设置页左导航「返回」：1 级字色 + 图标同 1 级 + 字重 500）（已随本批推送）

设计师（点 `#root > div:nth-of-type(1) > div > div > aside > button.settings-back > span`）：
「这里用1级字色且加粗」；同日追加两条：**「返回图标也提亮」**、**「返回字重改回 500」**。

### 实现

- `packages/webview/src/styles/host-desktop.css` —— 「设置栏返回行」块后追加：

```css
/* 设计师 0916 评论（点左导航 `span`「返回」）「这里用1级字色且加粗」 */
[data-host="desktop"] .settings-back {
  color: var(--vscode-foreground);
  font-weight: var(--cc-font-weight-medium, 500);
}
/* 同日「返回图标也提亮」：SVG 随文案取同一 1 级色 */
[data-host="desktop"] .settings-back svg,
[data-host="desktop"][data-theme="dark"] .settings-back svg {
  color: var(--vscode-foreground);
}
```

- 同时把第三十八轮「设置页图标统一 `#565A60` / `#9A9EA5`」组里的 `.settings-back svg` **摘出单列**
  （删掉那条选择器，只留 `.settings-nav-item svg`），避免同特异性规则互相压制。

### 取值口径

- **文字色**从 base 的「次要说明」档（`SettingsPage.css:108` 取 `--vscode-descriptionForeground`：
  浅 #606060 / 深 #A0A5A8）提到 **1 级文字色**。取 `--vscode-foreground`，因为设置左导航的
  1 级参照物 `.settings-nav-item`（`SettingsPage.css:186`）同取该变量：浅色档该变量由宿主注入 =
  #202020，深色档由 dark 块映射（`:root[data-host="desktop"][data-theme="dark"]`
  `--vscode-foreground → --cc-text-primary` = #E5E7E8）给出 ⇒ 两档都与同栏导航项默认态**逐值一致**，
  且随宿主主题自适应（不写死字面量）。
- **图标色**原按第三十八轮图标规范留灰档（浅 #565A60 / 深 #9A9EA5），同日按「返回图标也提亮」改取
  同一个 `var(--vscode-foreground)`（= 与文案同色；浅 #202020 / 深 #E5E7E8）。
- **字重**先按「加粗」做到 600（`--cc-font-weight-semibold`），同日按「返回字重改回 500」回落 500
  （`--cc-font-weight-medium`）。
- 作用域限 `[data-host="desktop"]`；实测宿主切 `ide` 后浅 #606060 / 深 #9D9D9D、字重 500 不变
  ⇒ IDE / VS Code 观感零回归。

### 实测（改前 → 改后，1440×900 DPR2）

| 项                     | 改前                                           | 改后                                                                                                                           |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 文案色（浅 / 深）      | #606060 / #A0A5A8，字重 500                    | **#202020 / #E5E7E8**，字重 **500**（v1 曾按「加粗」做 600，同日按她「改回 500」回落）                                         |
| 同栏导航项（1 级参照） | #202020 / #E5E7E8                              | 同左（未受影响）                                                                                                               |
| 图标                   | 浅 #565A60 / 深 #9A9EA5 · 16×16 · `path d` 442 | **浅 #202020 / 深 #E5E7E8**（同日按「图标也提亮」，几何未动）                                                                  |
| 按钮盒 / 圆角 / 字号   | 215×30 · r8 · 14px                             | 同左                                                                                                                           |
| 文案盒                 | 28×16（单行）                                  | 28×16（单行，无位移、无换行）                                                                                                  |
| hover 底色             | 浅 #EEF0F3 / 深 rgba(255,255,255,.08)          | 同左                                                                                                                           |
| 像素差异               | —                                              | 4 场景 1.313~1.315%（1077~1079 设备像素），包围盒 `[45,24,142,51]` **覆盖图标区 + 文字区**（v1 只改文案时是 `[89,24,142,52]`） |
| 控制台                 | 0 pageerror                                    | 0 pageerror                                                                                                                    |

副作用（已报备）：① hover 的文字色变化消失 —— base hover 取 `--vscode-foreground`（浅 #202020 / 深 #E5E7E8）
与新静止色同值，悬停只剩底色变化；② 返回图标现在比同栏 7 个导航项图标亮/深一档（那些仍是灰档）。

### 同日追加两条（她点名）

- **「返回图标也提亮」** → 左箭头 SVG 从第三十八轮图标组（#565A60 / #9A9EA5）**摘出单列**，
  改取 `var(--vscode-foreground)`（= 与文案同色，浅 #202020 / 深 #E5E7E8）；第三十八轮那组
  现在只剩 `.settings-nav-item svg`（7 个导航项图标仍留灰档）。
- **「返回字重改回 500」** → 600 → 500（`--cc-font-weight-medium`）。
- 追加后实测（原始基线 → v1 → v2）：文案 浅 #606060/500 → #202020/600 → **#202020/500**、
  深 #A0A5A8/500 → #E5E7E8/600 → **#E5E7E8/500**；图标 浅 #565A60 → #565A60 → **#202020**、
  深 #9A9EA5 → #9A9EA5 → **#E5E7E8**。像素差异（原始 vs 本版）1.313~1.315%，
  包围盒起点 `x=45`（设备像素）**覆盖箭头图标区**（v1 时是 `x=89` 纯文字区）⇒ 图标确随文案提亮；
  图标几何 16×16 / `path d` 442 未变，按钮盒 215×30 r8、卡片 712×176、导航项 8 个、
  导航项文案与图标、hover 底色全部零变动，0 pageerror。

### 残留（未授权，供你点名）

- 7 个导航项图标仍是灰档 → 触发语 **「导航项图标也一起提亮」**。
- hover 文字反差消失 → 触发语 **「hover 文字再提亮一档」**（需契约新增比 1 级更亮的悬停档）。
- 浅色取的是宿主值 #202020（与同栏导航项一致），与 token `--cc-text-primary` 差 1 通道 →
  触发语 **「浅色用 token #1F2329」**。

### 验证脚本与证据

- 脚本：`CC02/probe-settingsback-color-0916.mjs`（现状取证，含同页 1 级参照物采集）、
  `/tmp/pw-0916/sb2.mjs`（改前注入对照 + 改后实测，浅/深 × 静止/hover）、
  `/tmp/pw-0916/sb-gate.mjs`（宿主 `ide` 分叉验证）、`CC02/build-settingsback-0916.py`（差异像素 + 墨迹 bbox + 6× 放大）、
  `CC02/build-settingsback-page-0916.py`（本页）。
- 证据目录 `CC02/走查/0916-返回按钮字色/`：`measure.json`、`measure-rest.json`、`pixel-report.json`（v1 对基线）、
  `measure-v2.json`、`pixel-report-v2.json`、`trio-*.png`（三版竖排：原始 / v1 / v2）、
  `back-{light,dark}-{rest,hover}-{before,after}.png`、`v2-{light,dark}-{rest,hover}-{before,after}.png`、
  `sbs-*`、`zoom-*`、`diffmap-*`，
  自测页 `0916-返回按钮字色-修复自测.html`（v2，含三版对照；Artifact https://codechat.codewave.163.com/code/artifact/h04fk95l2b ）。

---

## 0916 评论（输入区发送按钮禁用态：浅色 hover 不再变色）（已随本批推送）

设计师（点 `.input-buttons-row` 内 `button.send-button.ai-send-btn`）：
「浅色模式发送按钮禁用态，hover 不应该变色」。

### 根因

base `MessageInput.css:169` 有一条 `.ai-send-btn:disabled:hover { background: var(--vscode-button-background) }`
—— 与桌面端禁用态规则（`host-desktop.css` `[data-host="desktop"] .ai-send-btn:disabled`）**同特异性 (0,3,0) 但后加载**，
于是浅色下 hover 把禁用底 `--cc-fill #F0F2F5` 换成主按钮色 `#1F2329`（实测复现：`#F0F2F5 → #1F2329`）。
深色档因为 `[data-host="desktop"][data-theme="dark"] .ai-send-btn:disabled` 特异性更高（0,4,0），本来就不受影响。

### 实现

- `packages/webview/src/styles/host-desktop.css` —— 把 `:disabled:hover` 并进桌面端禁用态那条（升到 0,4,0），
  改一个选择器、不动任何值：

```css
[data-host="desktop"] .ai-send-btn:disabled,
[data-host="desktop"] .ai-send-btn:disabled:hover {
  background: var(--cc-fill, #f0f2f5);
  color: var(--cc-text-disabled, #bec1c6);
  opacity: 1;
}
```

- 深色档保持原样：`[data-host="desktop"][data-theme="dark"] .ai-send-btn:disabled`（同为 0,4,0、在本组之后）
  仍后出现胜出 ⇒ 深色禁用态hover 保持 `rgb(255 255 255 / 8%)`。

### 实测（1440×900 DPR2，浅/深 × 禁用/激活 × 静止/hover）

| 场景                  | 改前                                | 改后                                                |
| --------------------- | ----------------------------------- | --------------------------------------------------- |
| 浅 · 禁用静止         | #F0F2F5                             | #F0F2F5（0 像素差异）                               |
| 浅 · 禁用 hover       | **#1F2329**（主按钮色，看着像可点） | **#F0F2F5**（同静止；改动 3848 设备像素 / 35.577%） |
| 浅 · 激活静止 / hover | #1F2329 / #34383F                   | 同左（0 像素差异，未误伤）                          |
| 深 · 禁用静止 / hover | rgba(255,255,255,.08) / 同          | 同左（本轮无变化）                                  |
| 深 · 激活静止 / hover | #E0E3E5 / #F0F2F3                   | 同左                                                |

几何零变动：按钮盒 32×32 · r8、`input-buttons-row` 566.5×32；行内其余 3 颗按钮
（添加 / 快捷指令 / 权限模式「修改前询问」）背景与文字色前后逐值相同；0 pageerror。

### 残留（未授权，供你点名）

- 同类「禁用态被 base hover 点亮」的写法可能还有别的控件 → 触发语 **「其余禁用按钮也查一遍 hover（浅色）」**。
- 禁用态现在是 `opacity: 1` + 底色/文字双灰（codechat composer 规范）；若想改回透明度口径 →
  触发语 **「禁用态用底色区分改为 opacity」**。

### 验证脚本与证据

- 脚本：`CC02/probe-sendbtn-disabled-0916.mjs`（现状，含行内结构与四颗按钮读数）、
  `/tmp/pw-0916/send2.mjs`（前后对照 + 激活态对照）、`CC02/build-sendbtn-0916.py`（差异像素 + 对照图 + 本页）。
- 证据目录 `CC02/走查/0916-发送按钮禁用态/`：`measure.json`、`measure-v.json`、`pixel-v.json`、
  `v-{light,dark}-{disabled,enabled}-{rest,hover}-{before,after}.png`、`v-row-*`、`sbs-*`，
  自测页 `0916-发送按钮禁用态-修复自测.html`（Artifact https://codechat.codewave.163.com/code/artifact/lmvnzp6zwp ）。
- 取证注意：本轮「改前」用同面注入复现 base 规则（单属性变化适用）；深色档的注入会被 `--cc-fill` 深色值污染，
  深色基线取**未注入那次真实运行**的读数（静止与 hover 同为 8% 白）。

## 0916 评论（所有图标 hover 时提亮：浅 1 级 #1F2329 / 深白 #FFFFFF）（已随本批推送）

**她的评论**（点面板页签右侧 `button.preview-pane-button`）：
「所有的 icon 能不能像这里这样 hover 的时候颜色会提亮」。
范围她同日拍板：**「排除主按钮 / 危险 / 语义色」**——即只补「hover 只变底、图标色不动」的
ghost 图标与「图标 + 文字」控件。

**参考语言**（同文件 `.preview-pane-button` 第 1691 / 1698 行）：常态灰 → hover **1 级文字色**，
浅 `#565A60 → #1F2329`、深 `#9A9EA5 → #FFFFFF`。hover 底色仍由原有 `--cc-fill-hover` 规则提供，
本条只补文字 / 图标色。

**规则**（`host-desktop.css` 末尾新增，浅 / 深各两条共 4 组选择器）：每组都写两份 `:is(...)`——
`X:hover`（改按钮自身文字色）与 `X:hover :is(svg, .codicon)`（图标自带颜色的场景，如
`.desktop-session-group-header .codicon`）。15 个选择器：
`.desktop-sidebar-more-btn:not(.is-active)`、`.desktop-sidebar-new-chat`、`.desktop-session-more-btn`、
`.desktop-session-group-header`、`.account-card-more-btn`、`.account-card-collapse-btn`、
`.header-button:not(.active)`、`.desktop-pane-close`、`.write-preview-open`、`.toolbar-icon-button`、
`.desktop-panel-tabs-add`、`.message-action-btn`、`.task-list-chevron`、`.queued-chevron`、
`.settings-nav-item:not(.is-active)`。

> 注：第三十八轮图标规范原写「normal 与 hover 图标色均 #565A60…图标色保持不变」，
> 本条即对该句的修订——规范后续按「hover 提亮到 1 级」理解（待 codex 一并回写 skill）。

### 实测（CDP `CSS.forcePseudoState({forcedPseudoClasses:['hover']})`，1440×900 DPR2，6 状态 × 浅/深）

24 个 icon 签名盘点，改前 → 改后（「变了但未命中目标值」清单为**空**）：

| 控件                                 | 区域   | 浅色                  | 深色                  |
| ------------------------------------ | ------ | --------------------- | --------------------- |
| `.desktop-sidebar-more-btn`          | 侧栏   | #565A60 → **#1F2329** | #9A9EA5 → **#FFFFFF** |
| `.desktop-sidebar-new-chat`          | 侧栏   | #565A60 → **#1F2329** | #9A9EA5 → **#FFFFFF** |
| `.desktop-session-more-btn`          | 侧栏   | #565A60 → **#1F2329** | #9A9EA5 → **#FFFFFF** |
| `.desktop-session-group-header`      | 侧栏   | #565A60 → **#1F2329** | #9A9EA5 → **#FFFFFF** |
| `.account-card-collapse-btn`         | 侧栏   | #606060 → **#1F2329** | #A0A5A8 → **#FFFFFF** |
| `.header-button.header-panel-toggle` | 对话头 | #565A60 → **#1F2329** | #9A9EA5 → **#FFFFFF** |
| `.desktop-pane-close`                | 对话头 | #565A60 → **#1F2329** | #9A9EA5 → **#FFFFFF** |
| `.write-preview-open`                | 对话头 | #565A60 → **#1F2329** | #9A9EA5 → **#FFFFFF** |
| `.toolbar-icon-button`               | 工具行 | #565A60 → **#1F2329** | #9A9EA5 → **#FFFFFF** |
| `.message-action-btn`                | 消息行 | #606060 → **#1F2329** | #CCCCCC → **#FFFFFF** |
| `.settings-nav-item`（未选中）       | 设置页 | #565A60 → **#1F2329** | #9A9EA5 → **#FFFFFF** |

### 排除（改前改后同值）

| 类别                             | 控件                                                                                                                                                                          | 浅                | 深      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------- |
| 实底主按钮                       | `.settings-save-btn.settings-plugin-new…`                                                                                                                                     | #FFFFFF           | #191C1E |
| 危险 / 删除                      | `.desktop-session-menu-item.is-danger`                                                                                                                                        | #D92D20           | #F4655C |
| 发送按钮禁用态（同批已治）       | `.send-button.ai-send-btn:disabled`                                                                                                                                           | #BEC1C6           | #FFFFFF |
| 选中态                           | `.settings-nav-item.is-active`                                                                                                                                                | #202020           | #9A9EA5 |
| 关闭族（另一窗口本轮已改）       | `.toast-close`                                                                                                                                                                | #202020           | #E5E7E8 |
| 设置「返回」（另一窗口本轮已改） | `.settings-back`                                                                                                                                                              | #202020           | #E5E7E8 |
| 常态已是 1 级（无需改）          | `.desktop-host-trigger`、`.desktop-workdir-trigger`、`.confirmation-close-btn`、`.desktop-session-menu-item`、`.permission-mode-select.mode-default`、`.account-api-info-btn` | #202020 / #202020 | #E5E7E8 |

只改颜色不动几何：涉及控件的盒 / 字号 / 圆角 / hover 底色盘点半前盘后逐值相同。

### 未覆盖 / 待点名

- `.desktop-panel-tabs-add`、`.task-list-chevron`、`.queued-chevron`、`.preview-tab-close` 已在规则清单内，
  但 `desktop-full` 用例里**未渲染**（点检 存在=0），无活体证据；触发语「面板页签＋ / 任务卡 chevron 也要提亮」。
- 输入区拖动柄是无 class 的 `span[role=button]`、色值写在**行内**（`--vscode-descriptionForeground`），
  CSS 覆盖需 `!important` 或改 TSX，本轮未动；触发语「工具行拖动柄也提亮」。
- `.message-action-btn` 在用例里**未布局**（盒 0×0，`visible: false`，按需挂载但容器不占位），
  只有计算值证据（浅 #606060 → #1F2329 / 深 #CCCCCC → #FFFFFF），没有裁剪图。

### 可裁剪对照（6 个可见控件，浅 / 深 × 改前 / 改后）

同页回退：注入旧值 `!important` 重建「改前」，鼠标与强制 `:hover` 都保持在位，只改颜色。
像素差异落在图标笔画内（悬停底色前后同值）：

| 控件              | 浅色差值 | 深色差值 |
| ----------------- | -------- | -------- |
| 侧栏「新对话」    | 0.48%    | 0.48%    |
| 侧栏 more（活动） | 3.18%    | 3.18%    |
| 会话分组标题      | 1.35%    | 1.35%    |
| 会话行 more       | 0.38%    | 0.38%    |
| 对话头 面板切换   | 3.54%    | 3.54%    |
| pane 关闭         | 1.24%    | 1.24%    |

对照图 `CC02/走查/0916-icon-hover/0916-icon-hover-对照.png`（行 = 控件，列 = 浅前 / 浅后 / 深前 / 深后）。

### 验证脚本与证据

- 盘点脚本：`CC02/probe-icon-hover-inventory-0916-v3.mjs`（v1/v2 用鼠标坐标 hover 会漏 0×0 盒、
  被 toast 遮挡与离屏元素，≤56px 宽度过滤会漏宽导航项，v3 改用 CDP 强制伪类）。
- 裁剪脚本：`CC02/probe-icon-hover-crops-0916.mjs` + 拼图 `CC02/build-icon-hover-sheet-0916.py`
  （运行需拷到 `/tmp/pw-0916/`，`playwright-core` 装在那里）。运行 / 取证三坑（已写进脚本注释）：
  ① CDP `DOM.getDocument` 必须 `depth: -1`，`depth: 1` 时深层节点
  未推给客户端、`forcePseudoState` **静默不生效**；② Playwright `addStyleTag` **没有 `id` 选项**，
  自建 `<style id>` 才能摘掉回退样式（否则旧值一直 `!important` 挂着）；③ 首屏 toast 是整层遮罩，
  会盖住对话头按钮与 pane 关闭按钮（`elementFromPoint` 命中 `.toast--top`），取证前先移除。
- 证据：`CC02/走查/0916-icon-hover/inventory-0916-{before,after}.json`（24 签名 × 6 状态 × 浅/深，
  `errs: []`）、`inventory-0916-{,v2,v3}.json` 中间版本、`inventory-{light,dark}.png`、
  `hover-<控件>-{light,dark}-{before,after}.png`、`hover-crops-0916.json`、`hover-diff-0916.json`。
- 本轮纯 CSS（`host-desktop.css` 末尾 4 条规则 + 注释），无 TS 改动；`errs: []`（0 pageerror）。

---

## 0916 评论（设置页页头 h1：字体绑定审计 + 字重 600 → 500）（已随本批推送）

设计师（点 `main > div > header > h1`「全局设置」）：「这里是否绑定了全局的字体，字重500就好」。

### ① 字体绑定（审计结论，无需改动）

- `.settings-page-header h1`（`SettingsPage.css:258`）规则只写 color / font-size / font-weight / line-height，
  **自身没有任何 `font-family` 声明** ⇒ 继承 `body`（`globals.css:4` 的 `var(--vscode-font-family)`）。
- 实测 computed：h1 `-apple-system, "system-ui", sans-serif`、body 同值、`.settings-page` 同值（逐字相同），
  token 声明原文为 `-apple-system, BlinkMacSystemFont, sans-serif`（浏览器把 `BlinkMacSystemFont` 归一为 `system-ui`）。
  ⇒ **已绑全局字体**，随宿主字体设置变化。

### ② 字重 600 → 500

- `packages/webview/src/styles/SettingsPage.css`：

```css
.settings-page-header h1 {
  color: var(--vscode-foreground);
  font-size: 20px;
  font-weight: var(--cc-font-weight-medium, 500); /* 600 → 500 */
  line-height: 25px;
}
```

- 写法与同页 `.settings-section-heading h2` / `.settings-row-copy h3`（上一轮 600 → 400）的 token 化一致；
  改动落在 base 文件 ⇒ IDE / VS Code 宿主的设置页同样 500（token 未定义时 fallback 也是 500，两宿主同值）。
- 波及面：所有使用 `.settings-page-header` 的视图统一生效 —— 全局设置 / 个性化 / 项目设置 / 插件市场 /
  技能 / 子代理 / 钩子 / MCP 服务（实测插件市场页头 h1 由 600 → 500，几何未动）。

### 实测（1440×900 DPR2，浅/深）

| 项                    | 改前                            | 改后                                                                                    |
| --------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| 页头 h1 字重          | 600                             | **500**                                                                                 |
| 字号 / 行高           | 20px / 25px                     | 同左                                                                                    |
| 颜色                  | 浅 #202020 / 深 #E5E7E8（1 级） | 同左                                                                                    |
| 页头盒 / 文字盒       | 712×25 / 80×23                  | 同左（零位移、不换行）                                                                  |
| 插件市场页头 h1       | 600 · 313.9×25                  | 500 · 313.9×25                                                                          |
| 同页 h2 / h3 / 说明 p | 400 / 400 / 400                 | 同左                                                                                    |
| 像素差异              | —                               | 页头裁切 0.63~0.699%；**整页 0.03%，包围盒只落在标题文字**（CSS `[484,43→563.5,62.5]`） |
| 控制台                | 0 pageerror                     | 0 pageerror                                                                             |

改后设置页层级 = 分节/行标题 400、说明 400、页头 500（靠字号 20 与字重双档区隔）。

### 残留（未授权，供你点名）

- 页头字号 20px 是否再收一档 → 触发语 **「页头字号也收一档」**。
- 页头说明 p 仍 400 → 触发语 **「页头说明也 500」**。
- 面板标题（计划 / 文件 / 差异 / 终端）契约上仍 600（0904 裁定「未点名保持 600」）→ 触发语 **「面板标题也降到 500」**。

### 验证脚本与证据

- 脚本：`/tmp/pw-0916/h1w.mjs`（前后对照：注入 600 复现改前 + 实测改后，含字体族取证与视图切换）、
  `CC02/build-settingsh1weight-0916.py`（差异像素 + 竖排对照图 + 本页）。
- 证据目录 `CC02/走查/0916-设置页标题字重/`：`measure.json`、`pixel.json`、`h1-{light,dark}-{global,plugins}-{before,after}.png`、
  `h1-*-full-*.png`、`sbs-*`，自测页 `0916-设置页标题字重-修复自测.html`（Artifact https://codechat.codewave.163.com/code/artifact/0hhprwwhoz ）。

## 0916 评论（对话头图标按钮：默认色补齐 + hover 底与刷新按钮一致）（已随本批推送）

**她的两条评论**（都在侧栏收起态的对话头左侧）：
① 点 `button.header-button`（「展开侧边栏」）「深色模式这个图标的默认色不对，现在很亮」；
② 点 `svg.header-icon`「浅色模式类似图标的背景色不对，检查是否绑定了变量，和刷新按钮一致」。

### ① 默认色：漏在「图标统一灰」清单之外 → 深色 #E5E7E8 过亮

- 第三十八轮「控件图标统一灰」（`host-desktop.css:2427` / `:2440`）只列了 `.header-panel-toggle`，
  **没有** `.header-collapsed-leading .header-button`（侧栏收起态的「展开侧边栏」按钮，24×24 @1793），
  它因此回落 base `--vscode-foreground`：浅 **#202020**（比同排图标灰深一档）、
  深 **#E5E7E8**（实测相对亮度 0.796；同排面板开关 #9A9EA5 仅 0.34 —— 就是她说的「很亮」）。
- 修法：整个 `.header-button` 族统一到第三十八轮图标灰 —— 浅 **#565A60** / 深 **#9A9EA5**
  （= 同排 `.desktop-pane-close`、刷新按钮的静止色）。`.header-button.active`
  （base 取 `--vscode-foreground`，:228）特异性更高，不受影响。

### ② hover 底：取的是 VS Code 工具栏 token，不是桌面 fill 角色

- `.header-button:hover`（`ChatHeader.css:78`）与 `.desktop-pane-close:hover`（`DesktopApp.css:1436`）
  取 `--vscode-toolbar-hoverBackground` → 浅 `rgba(0,0,0,.12)`（发灰）、
  深 `rgba(90,93,94,.31)`（一颗很亮的药丸，相对亮度远高于本族其余控件）。
- 刷新按钮（`.preview-pane-button:hover` @1697-1710）用 浅 **#EEF0F3**（`--cc-fill-hover`）/ 深 **8% 白**。
- 修法：按刷新按钮逐值对齐 —— 浅色档改成**绑定 `--cc-fill-hover`**（回答她「检查是否绑定了变量」）；
  深色档沿用本族既有口径 8% 白。

### 实测（1440×900 DPR2；同页注入回退值重建「改前」，真实鼠标 + CDP 强制 `:hover`）

| 控件                       | 状态          | 改前                                 | 改后                             |
| -------------------------- | ------------- | ------------------------------------ | -------------------------------- |
| 收起态「展开侧边栏」       | 浅 · 静止图标 | #202020                              | **#565A60**                      |
|                            | 深 · 静止图标 | **#E5E7E8**（亮度 0.796）            | **#9A9EA5**（0.34）              |
|                            | 浅 · hover 底 | rgba(0,0,0,.12)                      | **#EEF0F3**（`--cc-fill-hover`） |
|                            | 深 · hover 底 | rgba(90,93,94,.31)                   | **rgba(255,255,255,.08)**        |
| 面板开关（同族）           | 静止图标      | #565A60 / #9A9EA5                    | 同左（未受牵连）                 |
|                            | hover 底      | rgba(0,0,0,.12) / rgba(90,93,94,.31) | #EEF0F3 / 8% 白（同族对齐）      |
| hover 图标色（上一轮已定） | 浅 / 深       | #1F2329 / #FFFFFF                    | 同左（未动）                     |
| 几何                       | —             | 24×24 @12,10 / @1403,10              | 同左（零位移、无换行）           |
| 控制台                     | —             | 0 pageerror                          | 0 pageerror                      |

像素差异（同页回退对照，裁剪 56×56 设备像素）：浅静止 **3.54%** / 浅 hover **14.88%** /
深静止 **3.54%** / 深 hover **14.76%**，差异全部落在这颗图标的笔画与按钮底上。

### 未覆盖 / 待点名

- `.desktop-pane-close` 与刷新按钮在默认用例里**未渲染**（单 pane 无「关闭分屏」；右侧
  `.header-panel-toggle` 被原型预览工具条遮住、`elementFromPoint` 命中工具条），
  两者本轮的值取自 CSS 源（`DesktopApp.css:1436` / `host-desktop.css:1697-1710`）并以 computed 复核；
  触发语「多分屏再验一次 pane 关闭」。
- `.header-button.active` 仍是 base 的 `--vscode-toolbar-activeBackground`（VS Code 蓝底），
  用例中未见 `.active`，本轮未动；触发语「面板开关选中的底也换中性色」。
- 深色 hover 底没接 token（`--cc-fill-hover` 深色值 = #303436 不透明灰，与本族既有「8% 白」口径不同）；
  触发语「深色 hover 底也统一走 token」。

### 验证脚本与证据

- 脚本：`CC02/probe-header-icon-fix-0916.mjs`（同页回退对照 + **可命中实例选择**：多个同名按钮时用
  `elementFromPoint` 挑出真正可见的那个，否则截图会落到盖在它上面的原型预览工具条上）、
  `CC02/build-header-icon-fix-0916.py`（对照表）。
- 证据目录 `CC02/走查/0916-头部图标/`：`header-fix-0916.json`、
  `fix-收起态-展开侧边栏-{light,dark}-{before,after}-{rest,hover}.png`、`header-fix-diff-0916.json`、
  对照图 `0916-头部图标-修正对照.png`；另 `header-icons-0916.json`、`header-dom-{light,dark}.html`
  （元素定位）、`header-open-dom-{light,dark}.html`。
- 本轮纯 CSS（`host-desktop.css` 末尾新增 3 组规则 + 注释），无 TS 改动。

## 0916 评论③（侧栏品牌行图标按钮 hover 底色：漏改补齐）（已随本批推送）

**她的评论**：点 `svg.header-icon` @
`#root > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div > span:nth-of-type(2) > button > svg`
——「这里的是不是漏改了」。

### 先把路径解析成元素（避免猜）

在 8899 实测把该路径逐段解析（`CC02/probe-resolve-path-0916.mjs`）：命中
`.desktop-sidebar-header > .desktop-sidebar-actions > span.tooltip-container:nth-of-type(2) > button.desktop-sidebar-more-btn`
= **侧栏品牌行的「收起侧边栏」按钮**（span#1 是「活动」，两者同 class；她的 svg 带
`header-icon`，所以是第 2 个）。全页 `svg.header-icon` 的按钮只有 3 个：活动/收起侧边栏、
账户卡「收起用量」、对话头面板开关。

### 结论：**是漏改**，漏的是 hover 底色（不是颜色、不是尺寸）

上一轮已把 `.header-button:hover` / `.desktop-pane-close:hover` 的底色从
`--vscode-toolbar-hoverBackground` 换到桌面 fill 角色，但**同排 `.desktop-sidebar-more-btn:hover`
没跟着换**（`DesktopApp.css:146` 仍是工具栏 token）。逐族核对：

| 同族控件                                             | hover 底（浅 / 深）                           | 状态              |
| ---------------------------------------------------- | --------------------------------------------- | ----------------- |
| `.desktop-sidebar-new-chat`（764/767）               | #EEF0F3 / 8% 白                               | 0916 已换         |
| `.desktop-session-group-header`（700/704）           | #EEF0F3 / 8% 白                               | 0916 已换         |
| `.account-card-more-btn`（801/804）                  | #EEF0F3 / 8% 白                               | 0916 已换         |
| `.desktop-session-more-btn`（1671/1674）             | #EEF0F3 / 8% 白                               | 0916 已换         |
| `.account-card-collapse-btn`                         | #EEF0F3 / `--cc-fill-hover` 深 #303436        | 已换              |
| `.header-button` / `.desktop-pane-close`             | #EEF0F3 / 8% 白                               | 上一轮已换        |
| **`.desktop-sidebar-more-btn`（活动 / 收起侧边栏）** | 改前 `rgba(0,0,0,.12)` / `rgba(90,93,94,.31)` | **漏 → 本轮补齐** |

修法：把 `.desktop-sidebar-more-btn:not(.is-active):hover` 加入上一轮那两条规则
（浅 `var(--cc-fill-hover, #eef0f3)` / 深 `rgba(255,255,255,.08)`）。
`:not(.is-active)` 是为了保留「活动」选中态的品牌红底（`#FFEBE8` / 深色 18% 品牌红，
`DesktopApp.css:153`、`:160`）。

### 验证（`CC02/probe-verify-sidebar-hover-0916.mjs`）

- **hover 底**：活动 / 收起侧边栏 浅 `rgb(238,240,243)` / 深 `rgba(255,255,255,.08)`
  —— 与同排「新对话」「面板开关」**逐值相同**（= 刷新按钮口径）；改前实测
  `rgba(0,0,0,.12)` / `rgba(90,93,94,.31)`。
- **选中态不受影响**：「活动」`is-active` 浅 `#FFEBE8`（改前改后一致）、深
  `color(srgb .757 .161 .180 / .18)`，hover 也保持品牌色（点击实测）。
- **静止态零变化**：带键全量 DOM 快照（tag#id.class@index + 颜色 + 圆角 + 尺寸）对比
  「注入旧 token 回退样式 vs 不注入」→ 浅 0 / 深 0 处真实差异（深色那 3 处是
  `permission-mode-select` 过渡动画中途的 1/255 色差，与本轮无关）；基线连拍噪声 0。
- **几何与图标色不变**：两组按钮均 24×24，x/y 未动；hover 图标色仍 #1F2329 / #FFFFFF。
- **0 pageerror**；对照图 `CC02/走查/0916-头部图标/0916-侧栏图标-hover底色-对照.png`
  （浅/深各「改前 / 改后」，4× 放大；裁剪区域像素差异浅 6.98% / 深 6.67%，全在按钮底色上）。
- 证据 JSON：`header-fix-3-0916.json`（含选中态）、`header-icon-buttons-{light,dark}.json`
  （全页 `svg.header-icon` 按钮枚举）。

### 残留（同族但本轮未动，等她点名）

`--vscode-toolbar-hoverBackground` 仍留在：`.toolbar-icon-button:hover`（工具行，
`MessageInput.css:371`）、`.send-button:hover` / `.abort-button:hover`（128）、
`.permission-mode-select:hover`（246）、`.btw-panel-close:hover`、`.queued-action-button:hover`、
`.confirmation-close-btn:hover`、`.toast-close:hover`、`.desktop-panel-empty-item:hover`
（`DesktopApp.css:1571`）、`.message-action-btn`（`Message.css:453`）等 —— 各自属不同面
（工具行 / 消息流 / 弹层 / 空态），未在本族内。触发语：「工具行图标按钮 hover 底也统一」/
「消息操作按钮 hover 底也统一」/「弹层关闭 hover 底也统一」。

> ⚠️ 平行窗口提示：`docs/desktop-density-restore.md` 的工作区副本在另一窗口每次提交时会被
> lint-staged 的「未暂存补丁还原」写回旧快照（已两次把已推送小节改回「（工作区未提交）」、
> 表格退回未格式化版本）。提交本文件时必须**按 HEAD 内容 + 本人新增段构造 blob**（隔离索引 /
> `git hash-object`），不要整文件 `git add`，否则会连带把别窗口已推送的记录回退。

## 0916 评论：上下文用量环的轨道补成**整圈**（半圈轨道 → 空圆环 / 100% 沾满）+ 无用量两态整块隐藏（已随本批推送）

**她的评论**（点 `svg.compress-context-ring`）：「这里是真实的进度条吗？」→ 我答：是宿主上报的
**上下文窗口已用百分比**（非装饰、非 mock；8899 上显示的数字是各 mock 用例的固定值）→ 她接着指出
**「100% 时应该是进度沾满，而不是半圈轨道」**。

### 结论：环本体是真的，但轨道画错了

- **数据是真的**：宿主（CLI 会话）上报 `contextUsagePercent` → `contextUsage` 通知按 pane 路由
  （`ChatApp.tsx:1460`）→ `MessageInput.tsx` 渲染。纯展示：非按钮、不在 Tab 序、点击无行为；
  hover 气泡与 `aria-label` 同为「上下文已使用 N%」。
- **规格本就要求整圈**：`docs/specs/desktop/desktop-account-and-settings.md:77`（场景 4）写「宿主尚未
  推送用量信息…**显示空圆环**（不显示百分比数字）」——而实现里轨道是一条**左半环 path**
  （`d="M 20 12 A 8 8 0 0 0 4 12"`，实画长度 25.14 = 半周长），「空」的时候只有半圈，与「空圆环」不符。
- **可量化偏差**：进度弧按**整周长**算 dash（`2πr × pct%`），轨道却只有半周长 → pct > 50% 弧线就长到
  没有轨道的位置（64%：弧 32.17 vs 轨道 25.14，超出 7.03；100%：50.27 vs 25.14，超出 25.13 = 整整半圈）。

### 改动（`components/MessageInput.tsx`，纯结构、无样式值改动）

1. 轨道 `path`（左半环）→ **`<circle cx=12 cy=12 r=8>`**（整圈）：`class` 不变，故所有既有
   样式（含 host-desktop 的 16×16 / 线宽 2.6 / 浅 `#D4D7DE` / 深 12% 白）原样生效，**无需改 CSS**。
2. 顺带修一处相邻缺陷：0% / 用量未知时**不渲染进度弧** —— 原先 `stroke-dasharray: 0 C` 配合
   `stroke-linecap: round` 会在起点渲出一个圆点（实测 0% 时环上有一颗深色点），与「空圆环」不符。
3. **0% 时整颗指示器都不渲染**（她先写「为0时不渲染也不显示百分比」，我按「只隐藏弧与数字、
   保留空环」实现后她更正：「我的意思是为0时整个都不显示」）→ 渲染闸门由
   `!workdirSelector && showContextUsage` 扩为 **`… && contextUsagePct !== 0`**，
   环、数字、气泡、`aria-label` 一并消失（元素从工具栏移除，不占位）。
4. **后续同轮追加裁决：用量未知（`undefined`）也整块隐藏**（见下节）→ 闸门最终为
   **`!workdirSelector && showContextUsage && !!contextUsagePct`**（0 与 undefined 都是假值，
   一并挡掉；`NaN` 也不会渲染）。内层「弧 / 数字」的条件与 Tooltip 的 `disabled` 随之删除——
   走到渲染分支时百分比必然已知且非 0，`aria-label` 也必然非空。

### 追加：用量未知（宿主未推送）也整块隐藏（她 0916 追加裁决）

她对着工具栏的**空圆环**（`span.compress-context-button`）问「这里是进度为0的情况吗，这里是不是还渲染出来了」
——实测那**不是 0%**，而是「宿主尚未推送用量」态：三个推了 `contextUsage` 的 mock 用例是
38%（队列）/ 52%（对话流全样式）/ 64%（desktop-full），**插件市场用例（`desktop-plugins`）与 IDE 用例
未推**，故落到 `contextUsage === undefined` 分支，按当时的实现渲染**空圆环**（宽 24px、无数字、无气泡、
`aria-label=""`，浅色轨道 `#D4D7DE` / 深 `rgba(255,255,255,.12)`）。我给出两态对照后，她选
**「未知时也整块隐藏」**。

- 顺带修掉一个 a11y 小瑕疵：旧实现这一态输出 **`aria-label=""`**（空字符串，语义为空）；
  现在该分支已不存在，`aria-label` 恒为「上下文已使用 N%」。

### ✅ 已确认（原「合并前需开发确认（MERGE-TIME REVIEW）」）：上下文用量环采用新行为，规格已回写

> **2026-09-16 已闭环**：仓库 owner 裁定**采用 ①**——「无用量（`undefined` / `0`）整块不渲染」是既定产品口径，
> 由开发改规格与实现对齐（**不回退实现**）；同时确认 `MessageInput.tsx` 的用量环与 `SettingsPage.css` 的共享视觉
> 改动**刻意三端统一**（VSCE/JetBrains 一并变，不收回桌面专属）。规格已回写
> `docs/specs/desktop/desktop-account-and-settings.md`（场景 1 补 0% 例外 / 场景 4 改为「不得渲染指示器」/ 独立测试补一句），
> 两条既有断言（单测 `contextUsageIsolation.test.tsx`、e2e `desktop-session-switch-state.e2e.ts`）已同步为「元素不存在」。
> 下列原始确认点与实测数据保留为过程留档。

> 本节原文（写于确认之前）：本节是**给开发看得见的确认点**（PR 描述里也附了同文案）。**未擅自改规格文件**，等确认后由她决定改规格还是改回实现。

- **不一致点（唯一一条）**：`docs/specs/desktop/desktop-account-and-settings.md:77`（场景 4）要求
  「宿主尚未推送用量信息，**当**指示器渲染，**则**显示**空圆环**（不显示百分比数字），且悬停**不弹出**气泡」。
  **本实现有意不实现「空圆环」这半句**：用量未知（`contextUsage === undefined`）时**整块不渲染**
  （与 0% 同）——环 / 数字 / 气泡 / `aria-label` 全都不存在，工具栏不留占位。
- **依据**：设计师 2026-09-16 裁决（先定「为 0 时整个都不显示」，随后追加「未知时也整块隐藏」）。
- **场景 4 的另一半仍满足**：用量未知时**不会**出现空气泡（Tooltip 整个不渲染，比原先「Tooltip disabled」更彻底）。
- **请开发二选一后确认**（**2026-09-16 已按 ① 确认**）：① 认可新行为 → 改该场景文案（删「空圆环」半句或整条删除）；
  ② 不认可 → 告诉我，我把该态改回「空圆环 + 无数字、无气泡」（改动量 = 一处渲染闸门）。
- 代码里的对应标注：`packages/webview/src/components/MessageInput.tsx:1851`（`⚠️ MERGE-TIME REVIEW` 注释块）。
- 附：本节所在分支的实现**不触碰** `docs/specs/` 下任何文件（`git status` 可核）。

### 实测（`desktop-queues`，1440×900 @DPR2/4，浅+深，0 pageerror）

| 项                                   | 改前                                     | 改后                                                                                                                                                                                                                                              |
| ------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 轨道实画长度 `getTotalLength()`      | **25.14**（半周长）                      | **49.94**（= 周长，`2π×8`）                                                                                                                                                                                                                       |
| 0%                                   | 半圈轨道 + 起点一颗深色圆点 + 「0%」数字 | **整颗不渲染**：`.compress-context-button` / `svg` / `.compress-context-pct` 三者均不存在，工具栏不留空位（实测 `.input-buttons-row` 内已无该节点）                                                                                               |
| 用量未知（宿主未推送）               | 半圈轨道、无数字                         | 先改为**完整空圆环**、无数字 → 追加裁决后**整颗不渲染**（与 0% 同；实测 `.input-buttons-row` 子元素从 `context-actions \| button-spacer \| compress-context-button \| permission-mode-container` 变为**跳过该节点**，无占位、无 `aria-label=""`） |
| 50%                                  | 上=轨道半圈、下=进度半圈，两者不相接     | 整圈轨道 + 上半圈进度                                                                                                                                                                                                                             |
| 64%（用例值）                        | 弧 32.17 > 轨道 25.14，弧尾悬空          | 弧 32.17 < 轨道 49.94，**全程落在轨道上**                                                                                                                                                                                                         |
| 100%                                 | 弧自成一整圈，背后只有半圈轨道           | **整圈轨道被进度填满**                                                                                                                                                                                                                            |
| 盒 / 线宽 / 颜色 / 字体 / 百分比文本 | 16×16 · 2.6 · 未变                       | 同左（仅轨道路径几何变化）                                                                                                                                                                                                                        |

- `pnpm -F wave-webview` 的 `tsc --noEmit` 通过（JSX 结构改动，无样式值改动）。
- 验证方式：`desktop-queues` 用例的 mock 值临时改成 0（该文件在 `prototype/.gitignore` 内、不跟踪）
  → 实测后**已还原为 38%**；另用 38% 复跑确认正常态未受影响。截图
  `CC02/走查/0916-上下文环/ring4-0pct-button-light.png`（0% 只留空环，中间版）、
  `ring5-0pct-row-light.png`（0% 整块消失，最终态）、`ring5-38pct-row-light.png`（38% 正常态，环 +「38%」）。
- 证据：`CC02/probe-context-ring-0916.mjs`（按 0/25/50/64/75/100% 逐值回放 + 4× 放大裁剪图 + `pageerror`）、
  截图 `CC02/走查/0916-上下文环/ring-*（改前）/ ring2-*（改后）/ ring3-0pct-natural-*（真实 0%）`。
- 「未知 / 0%」两态对照：`CC02/probe-ring-unknown-vs-zero-0916.mjs`（枚举用例 → 记
  `buttonExists / fillExists / pctText / ariaLabel / rowChildren / 工具条裁剪图`）、
  `CC02/probe-ring-all-cases-0916.mjs`（14 个 mock 用例逐一枚举环态：只有队列 38% / 对话流 52% /
  desktop-full 64% 有值，插件市场与 IDE 用例为「未推送」态，其余用例欢迎态不渲染）、
  数据 `CC02/走查/0916-上下文环/unknown-vs-zero.json`、图 `state-{unknown,zero}-{light,dark}-toolbar.png`
  （最终态：两态都无环，工具条连续无空位；改前的空圆环见本节文字实测与 live 页面）。
- 落点：`components/MessageInput.tsx:1846`（闸门）+ `:1856-1890`（环结构）；无 CSS 改动。

### 残留（未授权，供后续点名）

- **进度弧的起点不在整点**：注释写「counter-clockwise from 3 o'clock」，但 `transform="scale(-1,1) …"`
  只做了水平镜像 → 实测弧从 **9 点方向**起、向下（逆时针）生长：25% 时进度落在**左下**象限。
  候选：① 现状（9 点起逆时针）② 回到注释原意（3 点起逆时针）③ 常规做法（12 点起顺时针）。
  已出 25% / 64% 三态对照图 `CC02/走查/0916-上下文环/anchor-{current,anchor3,anchor12}-*.png`。
  触发语 **「进度弧从 12 点开始」** / **「进度弧按 3 点起」**。
- 该环只在**非欢迎态且有已知非 0 用量**时渲染（`!workdirSelector && showContextUsage && !!contextUsagePct`），
  故 mock 用例里要在「队列」（38%）或「对话流全样式」（52%）才能看到；`desktop-full` 里那颗 0×0 的是隐藏欢迎态 composer 的实例。
- **规格场景 4 原先与实现不一致**（规格要求「未推送用量 → 空圆环」，实现为整块不渲染）
  → **2026-09-16 已闭环**：规格按新行为回写（场景 1 / 场景 4 / 独立测试），见本节顶部「✅ 已确认」块；
  两条断言（单测 `contextUsageIsolation.test.tsx`、e2e `desktop-session-switch-state.e2e.ts`）已同步为「元素不存在」。
- 标题栏那段注释里的 `transform` 注释仍写「counter-clockwise from 3 o'clock」，实测起点在 9 点
  （见上「进度弧起点」残留）→ 触发语 **「注释也一起改」**。

## 0917 评论（消息队列条目：三图标换设计师稿 + 「编辑」chip 14px + hover 时整行抖动 + hover·选中色与圆角 + 只在被截断时才弹全文气泡）

设计师 0917 四条评论全落在同一条消息队列条目上（`div.queued-message-list-container`、`div.queued-item`）。
① ② ③ 已随本批推送（commit `7a00c0dc`，files：`HeaderIcons.tsx` / `QueuedMessageList.tsx` / `host-desktop.css`）；
④ 为本次改动（`QueuedMessageList.tsx` + `host-desktop.css`）。

### ① 三颗操作图标换设计师手改稿（仅桌面端）

- 落点：`components/HeaderIcons.tsx`。`QueueEditIcon` / `QueueSendIcon` / `QueueTrashIcon` 各自
  `isDesktopHost() ? (设计师 16 格 stroke-width 1.4 手改矢量) : (原 HEAD fill 路径矢量)`。
- 侧栏会话行的「删除」图标复用 `QueueTrashIcon` → 同样只在桌面端换新稿，IDE 端逐字节不变。
- 按钮盒同步放大以承载新稿：`[data-host="desktop"] .queued-action-button`
  `width/height 24px`（原 ~18px）+ `border-radius: var(--cc-radius-md, 8px)`，
  `svg 16px`（原 14px），`.queued-item-actions { gap: 8px }`（原 2px）。
- 宿主分叉实测：同一次运行里 `waveHostType=desktop` 走新稿、`ide-chat` 仍走旧稿
  （`fork-hostcheck.json` + `report/fk2-*`）。

### ② 「编辑」chip 字号对齐输入框档 14px

- `.queued-edit-chip { font-size: 14px }`（桌面档；写在 `.message-input` 的
  `font-size:14px/line-height:22px` 规则之后）。改前 13px，chip 盒高不变。

### ③ hover 「编辑」时整条下拉抖动 → 根因是 Tooltip 的 `disabled`（已修）

- 设计师原话：「我hover编辑的时候，整个下拉会抖动，检查原因」。
- 根因：行级 Tooltip 传了 `disabled`，而 `Tooltip` 的 disabled 分支是 **`return children`**（卸载包裹层）。
  指针停在行内时按钮显隐/结构重建 → 指针下的子树被换掉 → 浏览器重发 mouseout/mouseover → 状态翻转 →
  结构再变，如此往复 = 抖动。**不是**样式问题，故不能靠加大 padding / `pointer-events` 规避。
- 修法：不再卸载包裹层，改为「结构常驻 + 视觉压掉」。行级气泡容器加
  `className={…${actionsHovered ? " tooltip-suppressed" : ""}}`，CSS 用
  `[data-host="desktop"] .queued-item-tooltip.tooltip-suppressed > .tooltip-box { opacity: 0; visibility: hidden }`。
  ⚠️ 必须是**直接子选择器** `>`：三颗按钮自己的 Tooltip 是后代，用后代选择器会把按钮气泡一起压掉（已踩过）。
- 实测（真实鼠标横扫整行，MutationObserver 计 childList added/removed）：
  改前 4/4 行发生节点重建 → 改后 **0/0**（`jit1…jit4-queued-jitter.json`、`sweep-*.json`）。

### ④-1 hover / 选中（编辑中）底色与圆角接规范 token

| 状态                        | 改前（实测）                                   | 改后（实测）                                              |
| --------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| hover · 浅色                | `#EEF0F3`（已是 `--cc-fill-hover`）            | `#EEF0F3`（`var(--cc-fill-hover, #eef0f3)`，零变化）      |
| hover · 深色                | `#2A2B2C`（手写 `rgba(255,255,255,.08)` 合成） | **`#303436`**（`--cc-fill-hover`，与浅色同族语义）        |
| 选中 / 编辑中 · 浅色        | `#EEF0F3`（= hover 色，被桌面 hover 规则盖掉） | **`#E7E9ED`**（`--cc-fill-pressed`）                      |
| 选中 / 编辑中 · 深色        | `#393E41`                                      | `#393E41`（零变化）                                       |
| 编辑中 + 指针仍停在行内     | 浅色 → `#EEF0F3`；深色 → `#303436`             | 两档都保持选中色（浅 `#E7E9ED` / 深 `#393E41`）           |
| 圆角（静止 / hover / 选中） | 6px（硬编码）                                  | 6px（`var(--cc-radius-sm, 6px)`，值不变、来源改为 token） |

- 依据：skill `tokens/tokens.css`（radius sm 6）+ `codechat-ui/src/styles/global.css`
  （`.task-list-item` 圆角 `--cc-radius-sm`、`.task-row.is-active` 选中 `--cc-fill-pressed`）。
- 两处「不符规范」的成因：①深色 hover 是手写 8% 白，比 token 暗一档；
  ②桌面档原**没有选中态规则**，`.queued-item.editing` 只有 base 的 (0,2,0)，
  被 `[data-host="desktop"] .queued-item:hover`（0,3,0）压过 → 指针在行内时编辑行显示成 hover 色。
  修法：把选中态写在 hover 规则之后、并显式带 `:hover` 变体。
- ⚠️ token 定义核对：`--cc-fill-hover` / `--cc-fill-pressed` 本仓库**有定义**
  （`host-desktop.css:55-56` 浅色 `#eef0f3` / `#e7e9ed`、`:150-151` 深色 `#303436` / `#393e41`）；
  只有 `--cc-radius-sm` / `--cc-radius-md` 全仓 0 处定义（`tokens.css` 只在 skill 侧），
  故圆角一处带字面量 fallback（hover / 选中面 token 取值直接命中，fallback 只是防御性写法）。
- 实测证据：`spec3-row-spec.json`（浅/深 × 静止/hover/编辑中/编辑中+hover 四态逐行读 `background-color` 与
  `border-radius`）+ 截图 `spec3-{light,dark}-A-{hover,editing,editing-hover}-full.png`、
  汇总图 `report/queue-row-states.png`。

### ④-2 只有真被省略号截断的条目才弹全文气泡

- 设计师原话：「如果这里字数非常多应该是省略号hover 气泡展示全部，但是现在字数少就不应该有气泡」。
- 做法（`QueuedMessageList.tsx`）：逐条量 `.queued-item-text` 的 `scrollWidth > clientWidth + 1`
  （该 span 本身 `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`），命中才包 `Tooltip`；
  未命中直接渲染裸行。重算时机 = `ResizeObserver`（观察文本节点 + 列表容器）+ 条目增删/折叠切换；
  只在结果变化时 `setState`，避免与 ResizeObserver 自激。
- **布局中性**：`.queued-item-tooltip { display: block; width: 100% }`，包与不包布局不变 ——
  实测三档行盒均为 **742×32**（`spec3-row-spec.json` → `B.light/dark`）。
- 实测（临时用例 `prototype/mock/tmp-queue-trunc-0917.ts`：短 4 字 / 中 26 字 / 长 102 字）：

| 条目      | `truncated` | 溢出宽度 | 包 Tooltip | hover 可见气泡        |
| --------- | ----------- | -------- | ---------- | --------------------- |
| 短 4 字   | false       | 0        | 否         | 无（只有行 hover 底） |
| 中 26 字  | false       | 0        | 否         | 无                    |
| 长 102 字 | true        | 609px    | 是         | 全文气泡 ✓            |

- 长行上的组合复核（`long1-longrow.json`）：指针在**文字**上 → 显示全文气泡；移到**「编辑」按钮**上 →
  只显示「编辑」，行级气泡被 `tooltip-suppressed` 压掉（`rowTipSuppressed: true`）；
  横扫该行 added/removed = **0/0**（③ 的抖动修复未被这次结构改动破坏）。
- ⚠️ 该闸门写在**共享组件**里（未按宿主分叉）→ VS Code / JetBrains 宿主上的短文本条目也一并不再弹气泡。
  如需只改桌面，说一声即可加 `isDesktopHost()` 条件（一行）。
- 实测证据：`report/queue-trunc-light.png`（① 短文本 hover 无气泡 / ② 中文本无气泡 / ③ 长文本省略号 + 全文气泡）、
  `spec3-{light,dark}-B-row{1,2,3}-full.png`。

### ④-3 行高：单行 28px，**展开与收起都是 28px**（她 0917 追加指示）

- 设计师原话：「单行的话行高应该是28px，展开收起都是28px，类似内容skill中没有描述吗」。
- **Skill 里有这条**（答复给设计师的出处）：`references/design-system.md`「Menus」段 ——
  「Items: `32px` min height baseline; on the desktop host (`[data-host="desktop"]`, approved 2026-09-08
  wave round 4) **single-line items use `28px`**, superseding `32px` for these menus… hover
  `--cc-fill-hover`、selected `--cc-fill-pressed`」；同段下一条「two-line rows are exempt…keeps its
  natural height (`32px`)」，而队列文本 `white-space: nowrap` 永远是单行 → 不适用豁免。
  旁证：`references/common-components.md`「Compact `28px` actions are for dense inline lists」。
  ⚠️ 该契约把这条挂在 **Menus** 下，未点名「消息队列列表」，也没有「展开/收起行高一致」与
  列表上限的条款 → **候选回写项**（见下「契约回写候选」）。
- 改动：`[data-host="desktop"] .queued-item { height: 28px; flex-shrink: 0 }`。
  32px 是本仓库此前按 0916 评论「消息列队选项高度32px」定的值，现按 skill 单行契约收敛为 28px。
- `flex-shrink: 0` 是「展开收起都 28px」的关键：`.queued-items.expanded{max-height:180px}` 是列向 flex，
  行默认 `flex-shrink:1` → 展开时被压扁（本轮按钮从 18px 换 24px 后，实测下限从 22px 抬到 24px）。
  实测（`desktop-queues`，7 条，浅/深一致）：**收起 1 行 = 28px、展开 7 行 = 每行 28px**（`h28-row-height.json`）。
- 副作用（未授权，见残留）：行高不再被压扁后，7 条内容高 = 7×28 + 6×4(gap) = **220px**，
  而容器上限仍是 180px → 第 6 条会被裁 4px、第 7 条要滚动才能看到。

### 残留（未授权，供点名）

- **展开态列表上限 `max-height:180px` 与 28px 行高不是一个整数倍**：7 条内容 220px、
  可见区 180px（含 6×4=24px gap）→ 第 6 条裁 4px、第 7 条靠滚动。候选（均已量）：
  ① 保持 180（现状）② 上限改 **188px**（正好 6 条整行：6×28 + 5×4）③ 上限改 **156px**（5 条整行）
  ④ 展开时不限高、整列表全展示（7 条 = 220px）。触发语 **「展开时列表别裁一半」** /
  **「展开时列表全展示」**。证据：`h28-{light,dark}-{collapsed,expanded}.png`。
  **本轮处理 = 保持 180px 不变**（不改 `QueuedMessageList.css:49`）：28px 行高下 7 条 = 220px
  → 第 6 条裁 4px、第 7 条需滚动，属**已知并接受**项，待设计师在 180 / 188 / 156 / 不限高
  之间点选后再改（上列候选值均已量）。
- 三颗按钮的 hover 提示气泡仍是 base 档（12px / r2 / `vscode-widget` 面），未接桌面 token。
  触发语 **「提示气泡也统一到桌面档」**。
- 深色 hover 若设计师更偏 0916 侧栏那套手写 α 台阶（8% 白 = `#2A2B2C`）而非
  `--cc-fill-hover`（`#303436`），回退 = 一条规则。触发语 **「深色 hover 用侧栏 8% 台阶」**。

### 契约回写候选（交 codex，skill 仓库我不改）

- **W-31｜消息队列列表（composer 上方 queue list）纳入单行 28px 契约**：现契约把 28px 写在
  `design-system.md`「Menus」下（dropdown / el-select 项），未点名队列列表；且缺三条：
  ① 队列行与菜单行同值（28px / r6 / hover `--cc-fill-hover` / 选中 `--cc-fill-pressed`）；
  ② **展开与收起行高一致**（不得被 `max-height` + `flex-shrink` 压扁，需 `flex-shrink: 0`）；
  ③ 展开态列表上限与行高的整数倍数关系（现 `180px` 与 28px 行高不整除，会裁半行）——
  数值待设计师定（候选 156 / 188 / 不限高）。
- 另：三颗操作按钮的 hover 提示气泡仍是 base 档（12px / r2 / vscode-widget 面），
  是否纳入桌面 token 待定。

### 验证脚本与证据

- `CC02/走查/_tools/0917/verify-queued-row-spec-0917.mjs`（A 四态色/圆角 + B 三档截断闸门）、
  `verify-queued-longrow-0917.mjs`（长行气泡压制 + 横扫重建计数）、
  `verify-queued-tooltip-suppress-0917.mjs`（三颗按钮逐颗验气泡压制）、
  `verify-queued-row-height-0917.mjs`（④-3：收起/展开行高都 28px + 列表溢出量）、
  `repro-queued-states-shots-0917.mjs`（六态取证图）、
  `probe-queued-expanded-rowheight-0917.mjs`（展开态被压扁的成因三步对比）、
  `diag-queued-jitter-0917.mjs`（③ 的抖动诊断）。
- 数据：`CC02/走查/0917-队列图标/{spec3-row-spec,long1-longrow,jit1…jit4-queued-jitter,h28-row-height,expanded-rowheight}.json`、
  `ev/ev-shots.json`；图：`report/queue-trunc-light.png`、`report/queue-row-states-v2.png`、
  `report/tooltip-suppress-{light,dark}.png`、`h28-{light,dark}-{collapsed,expanded}.png`。
- 自测页：`CC02/走查/0917-队列图标/0917-队列条目-自测.html`（由
  `CC02/走查/_tools/0917/build-queued-report-0917.py` 生成，图内联 base64）。
- 全轮 0 `pageerror`；`tsc --noEmit` 通过。

## 0917 评论（任务列表 / 消息队列滚动条**位置**对齐其他面）

设计师评论：「任务＋消息队列的滚动条位置，可以和其他的下拉或者Bash的展示等等保持一致吗」

### ① 先量结论：滚动条视觉规格本来就一致，差在容器外那层内衬

- thumb 规格四处逐值相同：16px 轨道 / 8px 胶囊 / 距**自己那圈滚动容器**右缘 4~12px
  （下拉面板有 1px 边框，故显示为 5~13px）。浅深同值。
- 差异只在容器外：`.task-list-items`、`.queued-items.expanded` 长在卡片里
  （卡 `padding: 8px 12px 12px` + `border: 1px`），轨道被内衬往里推 13px，
  于是胶囊落在**卡片可见右缘内 17~25px**；而下拉面板（padding 0，条目通铺到面板边）
  与对话列（Bash 展示所在）只离各自可见边界 5~13px / 4~12px。
- 结构上对话列就是「内容 → 10px 内衬 → 轨道 → 4px → 胶囊」且轨道贴自己的可见边缘；
  任务/队列改前是「内容 → 0 → 轨道 → 4px → 胶囊」但轨道离卡片可见边缘还有 13px
  （卡片的 12px 内衬在滚动容器**外面**）—— 这就是肉眼看到的「滚动条离卡片右缘远了一截」。

### ② 改法（`host-desktop.css`，滚动条契约块之后）

```css
[data-host="desktop"] .task-list-items,
[data-host="desktop"] .queued-items.expanded {
  margin-right: -12px;
  padding-right: 12px;
}
```

负外边距把滚动容器（连同 16px 轨道）整体右移 12px 到卡片内衬边缘，等量右内衬把内容盒
宽度还回去 → 行宽/行高/hover 底色/文字全零位移，只有滚动条与它的透明轨道右移。

### ③ 实测（devicePixelRatio 2 截图逐像素定位；浅深同值）

| 表面             | 改前 thumb 距卡片可见右缘 | 改后       | 容器右缘        | 行（`.queued-item` / `.task-row`）右缘 |
| ---------------- | ------------------------- | ---------- | --------------- | -------------------------------------- |
| 消息队列（展开） | 17~25px                   | **5~13px** | 1220.5 → 1232.5 | 1204.5（改前/改后同值）                |
| 任务列表         | 17~25px                   | **5~13px** | 1220.5 → 1232.5 | 1204.5（改前/改后同值）                |

- 参照面（未动）：下拉面板 thumb 距面板可见右缘 5~13px；对话列 4~12px → 改后与下拉面板同值。
- 卡片可见右缘 1233.5 不变；`offsetWidth − clientWidth` 仍 16（滚动条照旧占位，非覆盖式）；
  文字右缘（`.queued-item-text` / `.task-title`）1104.5 / 1204.5 改前改后逐值相同。
- 列表不溢出（无滚动条）时内容盒右缘也不变 → 等于无改动。
- 作用域限 `[data-host="desktop"]`，IDE 宿主不受影响。

### ④ 残留 / 备用触发语

- 「滚动条留在卡片内衬里」= 撤回本次（恢复贴行的 17~25px）；
- 「对话列滚动条也一起挪」= 本次未动对话列（它本来就贴自己的可见边缘）。

### 验证脚本与证据

- `CC02/走查/_tools/0917/probe-scrollbar-align-0917.mjs`（两表面 × 浅深 before/after 截图 + 几何；
  「改前」用页面内注入 override 还原本次两条声明，几何与改前逐值等价，且不动共用文件）。
- `measure-scrollbar-thumb-0917.py`（众数底色 + 段宽 ≤9px + 避开裁剪边界的 thumb 定位器，
  修正前两版把内容/卡片底色边缘误判成 thumb 的问题）。
- `compose-scrollbar-align-0917.py`（出对比图 + 逐值报告）、`build-scrollbar-align-report-0917.py`（自测页）。
- 数据：`CC02/走查/0917-滚动条位置/{sb3-desktop-queues-align,sb3-align-report}.json`；
  图：`对比-滚动条位置-任务队列.png`；自测页：`CC02/走查/0917-滚动条位置/0917-滚动条位置对齐-自测.html`。
- 4 组截图全轮 **0 `pageerror`**。

---

## 0917 评论（设置页左导航**选中态**图标提亮：深色档漏改 + 两档统一接 `--cc-text-primary`）

设计师评论（点设置页左导航「AI 与扩展」组第 2 项「技能」的 `svg.header-icon`）：
「这里选中以后图标应该也变亮的吧，要和浅色模式保持一致」；随后裁定
「**浅色也根据全局变量来和深色保持一致**」→ 选中态文字与图标**统一接 `var(--cc-text-primary)`**。

### ① 现象（改前）

| 主题 | 选中项文字           | 选中项图标                                  | 未选中项图标        |
| ---- | -------------------- | ------------------------------------------- | ------------------- |
| 浅色 | `#202020`（13.40:1） | `#202020`（13.40:1）＝已提亮                | `#565A60`（6.53:1） |
| 深色 | `#FFFFFF`（12.29:1） | **`#9A9EA5`（4.57:1）＝与未选中项逐值相同** | `#9A9EA5`           |

→ **深色单侧漏改**：浅色本来就是对的，深色选中项图标被钉在静止灰档。

### ② 根因（特异性 + 加载顺序）

- base `SettingsPage.css:215` `.settings-nav-item.is-active svg`（0,2,1）本就让图标跟随选中文字；
- 桌面层静止态两条（`host-desktop.css`，0,2,1 与 base **打平** → 靠加载顺序决定；
  `index.tsx:6` 先加载 `host-desktop.css`、`SettingsPage.css` 在后 → **浅色档 base 胜出**）；
- 桌面层深色静止态那条 `[data-theme="dark"] .settings-nav-item svg`（**0,3,1**）反超 base
  → **深色档选中项图标被按回静止灰**。原注释「选中项保持同色（codechat 选中只变文字与底）」
  只对 codechat 成立：codechat 导航图标是 `<img :src>` 位图（改不了色），wave 是内联 SVG
  （`HeaderIcons.tsx`，`stroke="currentColor"`）→ 结论不能照搬，该注释已随本轮改掉。

### ③ 改法（`host-desktop.css`，设置左导航图标块）

```css
/* v1（已推 cc2f96f4）：两档取该档选中文字的字面量 */
[data-host="desktop"] .settings-nav-item.is-active svg {
  color: #1f2329;
}
[data-host="desktop"][data-theme="dark"] .settings-nav-item.is-active svg {
  color: #ffffff;
}

/* v2（本提交）：两档文字与图标统一接变量，深色随 token 落到 #E5E7E8 */
[data-host="desktop"] .settings-nav-item.is-active svg,
[data-host="desktop"][data-theme="dark"] .settings-nav-item.is-active svg {
  color: var(--cc-text-primary);
}
[data-host="desktop"] .settings-nav-item.is-active {
  color: var(--cc-text-primary);
  background: #e7e9ed;
}
/* 深色档只留底（字色走上面那条变量 → 深色解析为 #E5E7E8） */
[data-host="desktop"][data-theme="dark"] .settings-nav-item.is-active {
  background: rgba(255, 255, 255, 0.12);
}
```

取 (0,3,1)+(0,4,1) 两条而非单条，是为了让深色档不受上方静止态那条 (0,3,1) 的同分顺序影响。
新规则全部带 `[data-host="desktop"]` 前缀，未改 base → VS Code / JetBrains 宿主不受影响。

### ④ 实测

| 版本 | 浅色（文字＝图标）   | 深色（文字＝图标）            |
| ---- | -------------------- | ----------------------------- |
| 改前 | `#202020`（13.40:1） | `#FFFFFF` 文字 / #9A9EA5 图标 |
| v1   | `#1F2329`（12.98:1） | `#FFFFFF`（12.29:1）          |
| v2   | `#1F2329`（12.98:1） | **`#E5E7E8`（9.91:1）**       |

- **变量驱动已实测**：运行时把 `--cc-text-primary` 注入 `#ff0000`，浅深两档的选中文字与图标
  **同时**变红 → 「浅色也根据全局变量」可验证，不是巧合取值。
- 像素级影响（2 设备像素截图对撞）：浅色档 v2 对 v1 **0 像素差异**（`#1F2329` 就是该变量浅色值）；
  深色档 v2 差异 1313/463680 = **0.283%**，只落在选中行图标笔画 +「技能」二字，
  最大通道差 26（`#FFFFFF` → `#E5E7E8`）。
- 未选中 7 项、hover 底、几何 `215×30`、字重 w400 全部零变化；`tsc --noEmit` 0；
  `pageerror` 0；axe 4.13 浅深各 1 条 violations，均指向原型工具条 `<select>` 的 `region`
  （预览外壳、非产品 UI），左导航内 0 条、`color-contrast` 全过。

### ⑤ 残留 / 备用触发语（未授权，等她点名）

- 「选中态 hover 时图标也再提亮一档」= 本次未做 hover 档。
- **顺带发现的契约分歧（本次不动代码）**：深色设置导航 hover `rgba(255,255,255,.08)`（≈#2A2B2C）
  与选中 `rgba(255,255,255,.12)`（≈#343536）都是 alpha 底；skill 最新（未提交）
  `references/dark-theme.md:45` 写「Generic state backgrounds are opaque，唯一 alpha 例外是
  `fill-chrome-hover` 8%（侧栏/页头），**不含 settings navigation**」→ 按契约应为
  `--cc-fill-hover` `#303436` / `--cc-fill-pressed` `#393E41`。另：侧栏/页头那批 8% 白已有角色名
  `--cc-fill-chrome-hover`，可回接角色名（迁移项）。两者均待设计师裁决。

### 验证脚本与证据

- `CC02/走查/_tools/0917/probe-settings-nav-active-icon-0917.mjs`（argv `[outDir] [tag]`：逐项
  文字/图标色 + 半透明底**按 alpha 合成**后再算对比度 + hover 参照 + 选中项/整列截图）、
  `audit-settings-nav-0917-axe.mjs`、`build-settings-nav-icon-report-0917.py`（自包含 HTML）。
- 数据：`CC02/走查/0917-设置导航选中图标/{probe-before,probe-after,probe-after2,axe-settings-nav-0917}.json`；
  图：`active-{light,dark}-{before,after,after2}.png`、`nav-{light,dark}-*.png`；
  自测页：`CC02/走查/0917-设置导航选中图标/0917-设置导航选中图标-验收.html`。

### 契约回写候选（交 codex，skill 仓库不在此改动）

**W-32**：设置页左导航「选中态 = 文字与图标同升一档色，统一接 `--cc-text-primary`」，
并注明 codechat 参考实现因用 `<img>` 位图化图标而不具备该行为（wave 内联 SVG 以本仓实现为准）。

## 0918 评论（sticky 用户消息「贴顶悬浮」内边距与未悬浮气泡不一致）

设计师评论（`div.sticky-user-message`）：「这里悬浮起来以后内边距也发生了变化，希望不要变，
不要动到功能」 · 分支 `feat/0918-ui-polish-r1`（基点 `origin/main` `90529a37`）

### ① 先判「悬浮」是指 hover 还是贴顶 sticky —— 实测排除了 hover

- 鼠标悬停 sticky 卡：`padding` / 盒尺寸 / 文字内衬 / 圆角全部逐值不变，**只有背景色变**
  （`rgb(240,242,245)` → `rgb(231,233,237)`，即 `requestBubbleHoverBackground`）。
- 因此「悬浮」= 消息滚出视口上缘后贴顶的那条 sticky 卡（与第二十三轮同一家族：`悬浮后缺左边距 / 字重变细`）。

### ② 差异量化（DPR2 全页截图 + Range 文字墨迹盒）

墨迹口径：**文字墨迹相对卡片/气泡外框**（三态同口径）。

|                           | padding              | 文字墨迹内衬 L / T | 圆角    | 行高              | 卡片高 |
| ------------------------- | -------------------- | ------------------ | ------- | ----------------- | ------ |
| 改前 · 悬浮态             | 6px 10px             | L10 / T7.5         | 6px     | normal（≈19.6px） | 72px   |
| 改后 · 悬浮态             | **8px 12px**         | **L12 / T10.5**    | **8px** | **22px**          | 82px   |
| 参照 · 未悬浮气泡（未动） | 块 0 + 内层 8px 12px | L12 / T10.5        | 8px     | 22px              | —      |

一行话「浮起来」横向往左跳 2px、往上跳 3px。根因：base `.sticky-user-message` 自带
`padding: 6px 10px`，而桌面档普通气泡是 `.user-text-block{padding:0}` + 内层
`.message-content.user-content{padding:8px 12px}`。

### ③ 改法（`host-desktop.css` 第二十三轮 sticky 家族，新增 ③④⑤）

```css
[data-host="desktop"] .sticky-user-content {
  font-weight: 500; /* ② 第二十三轮 */
  line-height: 22px; /* ④ 0918 追加授权「悬浮态行高也统一成 22px」 */
}
[data-host="desktop"] .sticky-user-message {
  padding: 8px 12px; /* ③ 0918 评论「悬浮起来以后内边距也发生了变化」 */
  border-radius: var(
    --cc-radius-md,
    8px
  ); /* ⑤ 0918 追加授权「悬浮态圆角也用 8px」 */
}
```

- 设计师追加授权：「「悬浮态行高也统一成 22px」「悬浮态圆角也用 8px」只改桌面端哦」→ ④⑤ 已实施，
  两条值全部挂在 `[data-host="desktop"]` 下（IDE 宿主实测仍 base 档，见下）。
- 行高须写在内容元素上（卡片同高由内容行高撑出）：卡片 72 → **82px**（三行 3×22 + 16 = 82 ✓）。
- 只改 CSS，`onClick={() => scrollToMessage(stickyMessage.id)}` 未触碰
  （功能验收：改前 scrollTop 3215 → 点击后 418，改后 2898 → 335，均可滚回该条消息）。
- 悬浮（hover）仍**只变背景色**，padding / 圆角 / 行高 / 盒尺寸逐值不变。

### ④ 本家族残留：无

①（左边距）/ ②（字重）/ ③（内边距）/ ④（行高）/ ⑤（圆角）五条均已实现并逐值对齐参照气泡。

### 验证脚本与证据

- `CC02/走查/_tools/0918/probe-sticky-user-padding-0918.mjs`（hover 是否真的变 padding + 点击功能验收）、
  `probe-sticky-user-inset-shots-0918.mjs`（改前/改后/参照三态截图与几何，浅深两会话，
  「改前」用 page 内注入 override 还原 `padding: 6px 10px` + `border-radius: 6px` + `line-height: normal`，
  不动共用文件）、
  `diag-sticky-user-target-0918.mjs`（定位 sticky 对应消息行）、
  `check-sticky-ide-regression-0918.mjs`（宿主作用域回归：注入同名 class 合成节点读 computed，
  断言 desktop = 8px 12px / 8px / 22px / 500、ide = 6px 10px / 6px / normal / 400，全通过）。
- 数据：`CC02/走查/0918-sticky-user/{before,final}-desktop-full.json`（墨迹口径）、
  `final-desktop-full-shots.json`（三态几何）；
  图：`对比-sticky悬浮内边距.png`、`对比-sticky悬浮三项对齐.png`。
- IDE 宿主（`ide-chat` / `ide-logged-out`）实测 sticky 仍 6px 10px / 圆角 6px / 行高 normal / 字重 400
  （`[data-host="desktop"]` 作用域未越界）；全轮 **0 `pageerror`**。

## 0921 评论（侧栏「插件市场」入口：与新对话行距 2px + 选中态改成会话行同款）

评论原文（点 `button.desktop-sidebar-new-chat.is-active`「插件市场」）：
「插件市场距离新对话2px，选中状态和对话的选中状态保持一致，（图标不变色，仅灰色背景色）」。
设计师追加指示（同轮，看图后）：「hover和选中时图标都提亮」。

### ① 改前实测（`走查/_tools/0921/probe-plugin-entry-gap-0921.mjs`，DPR2 / 指针移开后读）

|                                     | 浅色                               | 深色                                             |
| ----------------------------------- | ---------------------------------- | ------------------------------------------------ |
| 入口行距（新对话下缘→插件市场上缘） | **16px**（4 + 12）                 | 16px                                             |
| 插件市场选中底                      | `#FFEBE8`（淡红）                  | `color-mix(brand 18%, transparent)`（暗红）      |
| 插件市场选中图标                    | `#C1292E`（品牌红，**变色**）      | `#C1292E`                                        |
| 插件市场文字                        | `#1F2329`（1 级，未变）            | `#E6E6E6`（1 级，未变）                          |
| 参照 · 会话行选中态                 | 底 `#EBEDF0`、标题 `#1F2329` / 400 | 底 `rgba(255,255,255,.12)`、标题 `#E6E6E6` / 400 |

根因两条：① 两个固定入口共用 `margin: 12px 0 4px`（host 层「新对话按钮与品牌行间距
Figma 17094 itemSpacing 12」是给新对话↔品牌行的），插件市场行白拿同样上边距 →
4 + 12 = 16px（会话树同款行距是 `DesktopApp.css .desktop-session-items` 的 `gap: 2px`）。
② `.desktop-sidebar-new-chat.is-active` 是品牌红字 + 淡红底，「活动」按钮的同族配色，
不是会话行选中态。

### ② 改法（2 处 base + 1 处 host 层；IDE 宿主不受影响）

`DesktopApp.css`：`.is-active` 改成与 `.desktop-session-item--current` 逐值相同的灰底，
**删掉 `color` 声明**（文字仍由 host 层 `span` 定为 1 级）：

```css
.desktop-sidebar-new-chat.is-active {
  background-color: #ebedf0; /* = .desktop-session-item--current 浅色档 */
}
html[data-theme="dark"] .desktop-sidebar-new-chat.is-active {
  background-color: rgba(255, 255, 255, 0.12); /* = 同规则深色档 */
}
```

`host-desktop.css`：① 图标灰清单仍保留 `:not(.is-active)`（灰清单只管常态），
按追加指示新增选中态提亮规则 —— **取 hover 提亮家族给同一按钮的两个值**
（浅 `#1F2329` / 深 `#FFFFFF`，见第三十九轮 hover 提亮清单），即「hover 和选中同档」；
「活动」按钮 `.desktop-sidebar-more-btn:not(.is-active)` 保持品牌红不动：

```css
[data-host="desktop"] .desktop-sidebar-new-chat.is-active {
  color: #1f2329;
}
[data-host="desktop"][data-theme="dark"] .desktop-sidebar-new-chat.is-active {
  color: #ffffff;
}
```

② 行距（紧跟 `margin: 12px 0 4px` 那条）：

```css
[data-host="desktop"]
  .desktop-sidebar-new-chat-tooltip
  + .desktop-sidebar-new-chat {
  margin-top: -2px;
}
```

选中态 + hover 不套 hover 底色（base `.desktop-sidebar-new-chat:hover:not(.is-active)` /
host 层两条 hover 覆盖都带 `:not(.is-active)`），与会话行「选中时 hover 不改底」一致。

### ③ 改后实测（浅深双档，全部通过）

- 行距 16 → **2px**（未选中/选中同值）；两个入口盒仍 30 高、`margin` 12/4 与 -2/4，
  插件市场 y 94 → 80；会话树 y 128 → 114、高度 753 → 767（`flex: 1` 吃掉这 14px），
  **账户卡片 y 881 未动**（整栏布局不变）。
- 插件市场选中底 = `rgb(235,237,240)` / `rgba(255,255,255,.12)` **逐值与同页会话行选中态相同**；
  选中图标 = `#1F2329` / `#FFFFFF`（**与 hover 提亮家族同值**），文字 = `#1F2329` / `#E6E6E6`
  （= 会话行选中标题）；未选中图标仍是 `#565A60` / `#9A9EA5`（灰清单）。
  本轮除颜色外无盒属性改动：行高 30 / 外边距 / `border-radius: 8px` 探针里逐值不变。
- 未选中 hover 两入口仍 `#EEF0F3` / `8% 白`（既有家族值，未触碰）；
  选中态 hover 底保持选中灰、图标提亮档不回落。全轮 **0 `pageerror`**。
- 宿主作用域：`DesktopApp.css` 只被 `DesktopApp*` 系列（桌面端专用组件）import，
  host 层新增规则带 `[data-host="desktop"]` → VSCE / JetBrains 无路径可达。

### ④ 残留 / 备用触发语（未授权，等她点名）

- 本轮追加指示已消解初版的一条残留（初版实现里选中态图标走常态灰、hover 才提亮，
  她看图后要求「hover 和选中时图标都提亮」→ 两条同档，见 ②①）。
- 会话行选中态 hover 时标题不变色（它是文字，无 hover 色规则），而本入口选中态 hover
  图标维持提亮档 —— 两者观感一致，无残留动作。
- 「活动」按钮（`.desktop-sidebar-more-btn.is-active`）仍是品牌红 + 淡红底 ——
  触发语：「活动按钮的选中态也一起改成灰底」。
- 选中灰用的是与会话行相同的字面量 `#EBEDF0` / `12% 白`（设计系统另有
  `--cc-fill-pressed` 浅 `#E7E9ED` / 深 `#393E41`，与会话行差 2~4 通道）——
  触发语：「选中底改走 --cc-fill-pressed」。

### 验证脚本与证据

- `CC02/走查/_tools/0921/probe-plugin-entry-gap-0921.mjs`（几何 + 三态 computed：
  未选中 / 选中 / 选中+hover，另测未选中 hover 两入口，浅深双档）。
- 数据：`CC02/走查/0921-plugin-entry/{before,after}-desktop-full.json`；
  图：`0921侧栏插件市场入口-改前改后.png`（浅深 × 未选中/选中 × 改前/改后 八格对照）。

## 0921 评论（插件市场整页内容区多画了一层底色）

评论原文（点 `div.plugin-market-content`，文案「插件市场浏览并安装插件市场的插件，扩展 Wave 的能力。w…」）：
「这里多了一层背景色，可以拿掉」。

### ① 实测：深色档下顶栏下方有一条横向色阶（浅色档看不出来）

| 采样点（DPR2 全页截图取像素）     | 浅色 改前 | 浅色 改后 | 深色 改前     | 深色 改后     |
| --------------------------------- | --------- | --------- | ------------- | ------------- |
| 内容区（CSS 700,300）/（700,700） | `#FFFFFF` | `#FFFFFF` | **`#111314`** | **`#181A1B`** |
| 左内衬 16px（268,300）            | `#FFFFFF` | `#FFFFFF` | `#181A1B`     | `#181A1B`     |
| 底内衬 16px（700,992）            | `#FFFFFF` | `#FFFFFF` | `#181A1B`     | `#181A1B`     |

沿 x=1200 扫列（y 0..140）：改前深色在顶栏 1px 边（`#34393C`）之下由 `#0D0F10` 渐变落进
`#111314`（内容面），改后同一渐变落进 `#181A1B`（根面）——**断线消失**。

根因：`.plugin-market-page` 根面画 `--vscode-editor-background`（桌面深色档 = `--cc-bg-inspector`
`#181A1B`），而 `.plugin-market-content` 又画 `--vscode-panel-background`（= `--cc-bg-conversation`
`#111314`，对话画布）→ 顶栏之下、左右 16px 内衬与底边都露出「整页里套一层」的色阶。
浅色档两者同为 `#ffffff`，故只在深色可见。同族整页（会话状态看板 `.session-board`）本就是
单一根面，没有第二层。

### ② 改法（`PluginMarketPage.css`，只删自己那一层 + 跟着改渐隐色变量）

```css
.plugin-market-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  /* 不画底色：用根面 --vscode-editor-background 透过 */
  --cc-tabs-fade-bg: var(--vscode-editor-background, #ffffff);
}
```

删掉 `background: var(--vscode-panel-background);`；市场切换条两端渐隐的底色
（spec ecosystem/plugin 场景 5）跟着改成根面同值 —— 本区已不画底色，渐隐色必须取身后
真实背景，否则渐隐会再次显出色差。根面本身（`--vscode-editor-background`）未动。

### ③ 改后实测

- 深色：内容区与左/底内衬、根面**同值 `#181A1B`**，整页只剩一条面（与 `.session-board` 整页一致）；
  浅色逐像素与改前一致（都是白）。
- `--cc-tabs-fade-bg` 计算值 = 根面（深 `#181a1b` / 浅 `#ffffff`）✓。
- 布局零改动：内容区 rect `[276,44,1148,940]`、`.settings-view` `[470,44,760,352]` 与改前逐值相同；
  全轮 **0 `pageerror`**。
- 作用域：`PluginMarketPage` 只在 `ChatApp` 的 `isDesktop` 分支渲染（VSCE / JB 的插件市场在
  设置页里、由 `.settings-page` 给底色）→ 非桌面宿主无路径可达。

### ④ 残留 / 备用触发语（未授权）

- 顶栏（看板壳类 `.session-board-toolbar`）下方仍有 1px 边 + 一层阴影渐变（改前改后都在，
  只是现在落进根面）—— 触发语：「顶栏下面那条分隔线/阴影也拿掉」。
- 若希望整页改成对话画布色（`#111314`）而不是根面 `#181A1B`，改 `.plugin-market-page`
  根面的 `--vscode-editor-background` 即可 —— 触发语：「插件市场整页底色用对话画布」。

### 验证脚本与证据

- `CC02/走查/_tools/0921/probe-plugin-market-bg-0921.mjs`（内容区 / 根面 / `.settings-view` /
  空态 / 祖先链的 computed 背景与变量，浅深双档；采样点归属另用 `elementFromPoint` 核实 ——
  CSS(700,12~46) 是 mock 的浮层 toast，勿当背景采样）。
- `CC02/走查/_tools/0921/compose-plugin-market-bg-0921.py`（像素采样表 + 对照图）。
- 数据：`CC02/走查/0921-plugin-market-bg/{before,after}-desktop-full.json`；
  图：`0921插件市场整页-背景层-改前改后.png`（浅深 × 改前改后，含顶栏与内容区上沿）。

## 0921 评论（作用域弹窗：描述应为 12px，标题 14px 与标题后的（内容）保持 12px）

评论原文（点 `button.settings-scope-option.is-selected`「用户（user）作为你的用户配置，所有项目可用」）：
「这里面标题是14px，下面的描述都应该是12px，标题后面（内容）也是12px」

### ① 改前实测（`走查/_tools/0921/probe-scope-option-type-0921.mjs`，用例 `desktop-plugins`）

| 元素                        | 改前                            | 改后                            |
| --------------------------- | ------------------------------- | ------------------------------- |
| 标题（`…-title`）           | 14px / 600                      | 14px / 600（未动）              |
| 标题后的 `（user）`（`em`） | **12px / 500**（本来就是 12）   | 12px / 500（未动）              |
| 描述（`…-desc`）            | **14px / 400 / 22px**（正文档） | **12px / 400 / 20px**（辅助档） |
| 描述墨迹高（同口径）        | 15.5px                          | 13.5px                          |
| 选中选项盒高                | 78px                            | 76px                            |

根因：作用域弹窗的 `.settings-scope-option-desc` 是全文件唯一一处仍按正文档
（14/22）写的说明文案 —— 同级说明（插件行 `.settings-plugin-desc`、锚点工程
`.settings-scope-option-project`）都已是辅助档 12/20。

### ② 改法（`SettingsPage.css` 单条规则：`color` 保留，只收字号行高）

```css
.settings-scope-option-desc {
  color: var(--vscode-descriptionForeground);
  font-size: 12px; /* 14px → 12px */
  line-height: 20px; /* 22px → 20px */
}
```

先按「就近新增一条规则」写过一版，实测未生效：文件里**已有**同名规则（`:1788`）且
在新增那条之后，同权重后者胜 —— 故最终只改既有那一条，不新增重复声明。

### ③ 改后实测

- 描述 14/400/22 → **12/400/20**（浅深双档逐值相同）；标题 14/600、`（user）` 12/500
  逐值不变；描述颜色不变（未选中 `descriptionForeground`、选中 `--cc-text-regular`，
  对比度不受影响）。
- 盒高随之变化（本次改动的连带结果）：选中选项 78 → **76px**、置灰选项 100.5 → 98.5px，
  弹窗整体矮 6px；横向尺寸（选项盒宽 540）与左缘 450 不变。
- 全轮 **0 `pageerror`**。
- 作用域：`.settings-scope-option-desc` 是**共享**类（桌面端整页与 VSCE / JetBrains
  设置页同一组件同一弹窗）→ 这次是 base 改动，**IDE 宿主的「安装 / 更换安装作用域」
  弹窗同样生效**（同一档文案，未做宿主分叉）。设计师 0921 追问后确认「不用分宿主，
  桌面端与 IDE 一起改」——即保持 base，不为这一条加 `[data-host="desktop"]` 限定。

### ④ 残留 / 备用触发语（未授权）

- 置灰选项里的原因说明 `.settings-scope-option-project`（「需先选择项目目录后才能选择
  此作用域」）是 12px / 行高 normal（未动）—— 触发语：「那句说明的行高也统一 20px」。
- 插件行的作用域胶囊 `.settings-scope-pill`（「用户 / 项目 / 本地」，14px/500、28px 高、
  min-width 88、r8）本轮未动 —— 触发语：「插件行的作用域胶囊也收成 12px」。
  （以上两条在 0921 的选项澄清里未被勾选。）

### 验证脚本与证据

- `CC02/走查/_tools/0921/probe-scope-option-type-0921.mjs`（用例 `desktop-plugins`：点行内
  「安装」开弹窗 → 三个作用域选项的 title / em / desc / project 的 computed 字号·字重·
  行高·颜色 + 墨迹盒，浅深双档）。
- `CC02/走查/_tools/0921/compose-scope-option-type-0921.py`（按选项盒动态裁剪的对照图）。
- 数据：`CC02/走查/0921-scope-option-type/{before,after}-desktop-plugins.json`；
  图：`0921作用域弹窗-描述字号-改前改后.png`（浅深 × 改前改后）。

## 0921 评论（设置页下拉：左右内衬不一致，三角太靠右）

评论原文（点 `select.settings-select`「中文English」）：

「下拉菜单的左右边距不一致，三角太靠右」

### ① 改前实测（`走查/_tools/0921/probe-settings-select-2themes-0921.mjs`，真回退后采集）

| 量项                       | 改前（`appearance:auto`） | 改后（自绘三角） |
| -------------------------- | ------------------------- | ---------------- |
| 文字墨迹左内衬             | **13.0px**                | **9.0px**        |
| 三角墨迹右内衬             | **3.5px**                 | **8.5px**        |
| 左右内衬差                 | **9.5px**                 | **0.5px**        |
| 三角墨迹尺寸               | 10.0 × 6.5                | 10.0 × 6.0       |
| 三角垂直中心（文字 16.50） | 17.00                     | 16.75            |
| `padding-right`            | 8px                       | 26px             |
| 盒尺寸 / 圆角 / 边框       | 260×32 / 6px / 1px        | 同（未动）       |

根因：原生外观（`appearance:auto`）的三角由系统绘制并**钉死在右框内缘**，`padding`
管不到它；同时系统还给文字额外约 4px 的内缩，于是「左边很空、三角贴边」。

> ⚠️ 本节表格里的「自绘三角 10×6」已在同日的评论②被换成官方矢量（8×4.5，见下一节）；
> 左右内衬、垂直居中、深浅一致这些量测结论不变。

取证方法上的一个坑：**不能靠注入 `appearance:auto` 复现改前态** —— 注入版的文字位置
比真实改前偏左 4px（浅色 799/34320 像素不同），量出来的内衬就成了 9.0px 而不是 13.0px。
故本轮改前基线一律用「真回退」（把那 19 行整块摘掉后重新采集），双主题各一张。

### ② 改法（`SettingsPage.css`，只作用于 select，不动同组输入框）

```css
.settings-select {
  -webkit-appearance: none;
  appearance: none;
  padding-right: 26px; /* 8 内衬 + 10 三角 + 8 间隔 */
  background-image: conic-gradient(
    from 135deg at 50% 0,
    currentColor 0 90deg,
    var(--vscode-input-background) 90deg
  );
  background-size: 10px 6px;
  background-position: right 8px center;
  background-repeat: no-repeat;
}
```

- 三角第二段用**输入框底色（不透明）**而不是 `transparent`：避免插值出深色毛边，
  深浅两档实测位图逐像素同形。
- 三角用 `currentColor` 跟随宿主前景色，无需为两档各写一条。
- 只加 `.settings-select` 覆盖，不改 `.settings-number-input` / `.settings-text-input`
  共用的 `padding: 4px 8px`，也未动任何 TSX。

### ③ 改后实测（浅深双档）

- 左右内衬 13.0 / 3.5 → **9.0 / 8.5**（差 9.5 → 0.5px，余下 0.5px 是墨迹抗锯齿）；
  深浅两档数值完全相同。
- 文字垂直位置 **16.50 未变**；字号 14px / 行高 normal / 圆角 6px / 边框色 /
  focus 边框（`rgb(160,165,168)`）/ disabled（`opacity .6`、`cursor: not-allowed`）
  逐值不变。
- 原生交互未受影响：三角是 `background-image`（不是覆盖层），点击中心与三角区的
  hit-test 仍都命中 select 本身；focus 后仍可聚焦。
- 全轮 **0 `pageerror`**。
- 副作用要主动交代：去掉原生外观后，系统原本给文字的那约 4px 内缩一并消失 →
  **下拉里的文字左移了 4px（13 → 9）**，正好与同页 `.settings-text-input` /
  `.settings-number-input` 的文字起点（8px padding）对齐；若更想保持文字原位，
  可把两侧都钉在 12px（触发语：「文字往回挪 4px」）。
- 作用域：`.settings-select` 是**共享**类（同一份 CSS，无 `[data-host]` 限定）→
  base 改动，**IDE 宿主的设置页同样生效**；同页「主题」下拉是第二颗同名控件，
  一并生效（已实测两颗 padding-right / appearance / 三角位置一致）。

### ④ 残留 / 备用触发语（未授权）

- 「文字往回挪 4px」（左右内衬都改回 12px，保留文字原位）。
- 「这个只在桌面端收边距」（若她希望 IDE 宿主保持原生外观 → 需要加
  `[data-host="desktop"]` 限定或宿主分叉）。

### 验证脚本与证据

- `CC02/走查/_tools/0921/probe-settings-select-2themes-0921.mjs <tag>`（打开设置页
  → 账户卡热区 →「更多」→ 设置；捕获该 select 的盒模型 / 外观 / 三角几何，
  元素、所在行、页面各截一张，浅深双档）。
- 数据：`CC02/走查/0921-settings-select/{before2,after2}-settings-select.json`；
  图：`before2/after2-select-{light,dark}-2x.png`、`before2/after2-row-{light,dark}-2x.png`。
- 修复对比报告（skill 固定母版 v1.1）：`CC02/走查/0921-settings-select-report/`。

## 0921 评论②（下拉三角改用会话分组 chevron 的官方矢量，并把方向翻正）

评论原文（点 `svg.desktop-session-group-chevron`，DOM `… > div > button > svg`）：

「三角可以用这个三角吗？还要注意箭头的方向，现在反了」

### ① 改前实测（上一版自绘三角画反了）

上一版用 `conic-gradient(from 135deg at 50% 0, …)` 画的三角**朝上**（尖在上、底在下 = ▲），
而原生外观那条是**朝下**的（尖在下）——实测位图逐行看宽窄：

| 版本                 | 箭头墨迹位图形态                    | 方向       |
| -------------------- | ----------------------------------- | ---------- |
| 原生（改前改后基线） | 两臂自上方分开、向下方收成一点（∨） | 朝下 ✓     |
| 上一版 conic 三角    | 尖在上、底边在下（▲）               | **反了** ✗ |

教训：画箭头必须**验方向**（不能只看尺寸/居中/内衬对不对），位图逐行打印一次就知道。

### ② 参照物（她点名的那个三角）

`svg.desktop-session-group-chevron` = `DesktopSidebar.tsx` 的 `GroupChevron`，16 视框，
`fill="currentColor"` 的一条官方矢量（Figma 13498:16662 up / 13561:39968 right）：

- 展开态墨迹 **8.00 × 4.50**（CSS），描边**厚 1.33**，圆角端点，两臂夹角 45°，
  中缝镂空（不是实心三角）；收起态是同一字形的 90° 旋转（「>」）。
- 颜色：浅色 `#565a60`、深色 `#9a9ea5`（`.desktop-session-group-chevron` 自己的两档）。

### ③ 改法（同一份矢量做 mask + `:has()` 限定，方向翻转成朝下）

```css
.settings-select {
  -webkit-appearance: none;
  appearance: none;
  padding-right: 24px; /* 8 内衬 + 8 三角 + 8 间隔 */
}

.settings-control:has(> .settings-select) {
  position: relative;
}

.settings-control:has(> .settings-select)::after {
  content: "";
  position: absolute;
  top: 50%;
  right: 9px; /* +1 = 让墨迹距输入框内缘 8px（与文字左内衬对称） */
  width: 8px;
  height: 4.5px;
  transform: translateY(-50%);
  background: var(--vscode-input-foreground);
  -webkit-mask: url("data:image/svg+xml,<svg …><g transform='translate(0,16) scale(1,-1)'>…</g></svg>")
    center / 16px 16px no-repeat;
  mask: url("…同上…") center / 16px 16px no-repeat;
  pointer-events: none;
}

.settings-control:has(> .settings-select:disabled)::after {
  opacity: 0.6;
}
```

- **为什么落到容器上**：原生 `select` 只能画背景图，而背景图里的 SVG **不继承 `currentColor`**
  （实测 `fill='currentColor'` 渲染成纯黑），要「官方矢量 + 跟随主题前景色」就必须用独立元素 +
  `mask`。`.settings-control` 同时承载文本框（服务端地址）与数字框，故用 `:has(> .settings-select)`
  限定（`:has()` 仓库内已在用）。
- `translate(0,16) scale(1,-1)` = 把侧栏那条**朝上的「^」翻转成朝下**（下拉的语义方向）。
- 停用态：三角不在 select 内，不会跟着 `opacity: .6` 降，故单独补一条。

### ④ 改后实测

- 三角墨迹 **8.00 × 4.00（阈值内的实心区；含抗锯齿端点为 8×4.5）**、厚 1.33、中缝镂空、
  **尖朝下** ✓（浅深两档位图逐像素同形）。
- 颜色跟随 `--vscode-input-foreground`：浅 `rgb(32,32,32)` / 深 `rgb(229,231,232)`（同一 token
  与下拉文字一致）。
- 墨迹右内衬 **8px**（距输入框内缘，与文字左内衬 8px 对称）；盒 260×32、圆角 6px、边框 1px、
  focus 边框、文字位置均未变。
- 作用域：只有「里面是下拉」的控制列出三角 —— 实测 4 个控制列里
  AI 回复语言 ✓ / 主题 ✓ 有三角，上下文长度（数字框）✗、服务端地址（文本框）✗ 没有。
- 交互：三角是 `pointer-events: none` 的装饰层，三角所在区域的 hit-test 仍命中原生 `select`
  （点击照旧打开原下拉）。
- 停用态：三角与下拉同为 `opacity: .6`。
- 全轮 **0 `pageerror`**。
- 与原生外观的差别（主动交代）：尺寸从 10×6.5 收到 **8×4.5**、线宽从 ~2.2 收到 **1.33** ——
  这是她指定的那条矢量本身的规格（比原生更细、更接近产品自己的 chevron 语言）。
- 作用域：仍写在共享的 `SettingsPage.css`，**IDE 宿主设置页同样生效**。

### ⑤ 残留 / 备用触发语（未授权）

- 「三角大一点」：现用字形自己的设计尺寸 8×4.5（侧栏就是这个尺寸）；放大需另定数值。
- 「侧栏分组 chevron 的方向也反了」：现侧栏是 **展开=「^」、收起=「>」**（`DesktopSidebar.tsx`
  的 `GroupChevron`，与 Figma 13498:16662 / 13561:39968 一致，已在预览实测 `aria-expanded=true`
  时渲染「^」）。本次未动它 —— 若她认为应该是「展开=∨」，触发语：「分组 chevron 展开朝下」。

### 验证脚本与证据

- `CC02/走查/_tools/0921/probe-select-caret-0921.mjs`（三角的 computed：盒/内衬/mask/颜色/
  `pointer-events`/命中测试/停用态；浅深双档 + 行上下文截图）。
- `CC02/走查/_tools/0921/probe-caret-scope-0921.mjs`（逐控制列核验只有下拉出三角）。
- `CC02/走查/_tools/0921/probe-group-chevron-0921.mjs`（侧栏 chevron 的形状/方向/两态路径）。
- 数据与图：`CC02/走查/0921-settings-select/caret-*.json|png`、
  `CC02/走查/0921-group-chevron/header-chevron-{expanded,collapsed}-2x.png`。

## 0921 评论（深色档四处整页面底色对齐「新对话」顶部/内容区）

评论原文：「深色模式下，下面指出地方的背景色（四处），和新对话顶部、内容区背景色要保持一致」——
四条分别点在 `.session-board-toolbar`（看板顶栏）、`.plugin-market-page`（市场整页根面）、
`.session-board-toolbar`（同前）、`.session-board`（看板根面）。四处都属**「替换会话区的整页面」**
（`ChatApp.tsx` 里由 `isDesktop` 门控渲染），占的正是 `.chat-container` 的位置。

### ① 实测：深色档整页面比对话面亮一档（浅色档两 token 同值，看不出）

探针 `probe-board-market-header-bg-0921.mjs`（computed + 沿祖先链第一个非透明底色），
像素带取样（CSS x 300–600，避开 mock 的发布提示 toast：实测占据 x 625–1074 / y 13–57）：

| 面                        | 深色 改前                 | 深色 改后     | 浅色 改前 | 浅色 改后 |
| ------------------------- | ------------------------- | ------------- | --------- | --------- |
| 看板根面 `.session-board` | `#181A1B`                 | **`#111314`** | `#FFFFFF` | `#FFFFFF` |
| 看板顶栏（透明，取根面）  | `#181A1B`                 | **`#111314`** | `#FFFFFF` | `#FFFFFF` |
| 市场根面/顶栏/内容区      | `#181A1B`                 | **`#111314`** | `#FFFFFF` | `#FFFFFF` |
| 参照：新对话顶栏/内容区   | `#111314`（前后同值未动） | `#111314`     | `#FFFFFF` | `#FFFFFF` |

全图 dominant 色同样一致：市场整页 `#181A1B` 95.3% → `#111314` 78.9%；看板面本色由
`#181A1B` 27.7% → `#111314` 10.8%（其余为透明叠层与侧栏 `--vscode-sideBar-background`）。

### ② 根因：整页面画的是「编辑器壳色」，对话列画的是「面板色」

`ChatApp.css` 里 `.chat-container` 的注释已写明这条约定：对话列（顶栏 + 消息沟槽 + 输入）
统一画 `--vscode-panel-background`，「宿主给 body 的 editor-background 是编辑器区外壳色，
否则会从透明包裹层透出来」。而看板根面（`SessionBoard.css` 基础规则 + 深色覆盖两处）与市场整页
根面（`PluginMarketPage.css`）画的是 `--vscode-editor-background` → 深色档两值不同
（`editorBg #181a1b` / `panelBg #111314`），整页面因此比对话面亮一档。浅色档两 token 同为
`#ffffff`，故只在深色可见。

### ③ 改法：两个整页面改指对话列同一个 token（+ 连带渐隐色变量）

```css
/* SessionBoard.css 基础规则 + 深色覆盖都改 */
.session-board {
  background: var(--vscode-panel-background, #ffffff);
}
[data-host="desktop"][data-theme="dark"] .session-board {
  background: var(--vscode-panel-background, #1e1e1e);
}

/* PluginMarketPage.css 根面 + 切换条两端渐隐底色 */
.plugin-market-page {
  background: var(--vscode-panel-background, #ffffff);
}
.plugin-market-content {
  --cc-tabs-fade-bg: var(--vscode-panel-background, #ffffff);
}
```

- **同族先例**：`TerminalPane.css` 早就是 `var(--vscode-panel-background, var(--vscode-editor-background))`
  （同为「替换会话区」的整页面），这次是把看板与市场整页对齐到同一约定。
- **渐隐色必须跟着走**：市场切换条两端的渐隐要盖在真实底色上，底色换 token 而它不换会出现渐隐色阶。
- `SettingsPage.css` 共享块里给 `.plugin-market-page` 也声明了 `--cc-settings-bg`（= editor-background），
  但该变量在本面**无人消费**（只有 `.settings-page` 自己用），故未动，避免波及 IDE 宿主设置页。
- **作用域**：两个面都是桌面端独有（组件在 `ChatApp.tsx` 由 `isDesktop` 门控，IDE 宿主不渲染），
  与本批其它 base 改动不同，**IDE 宿主不受影响**。

### ④ 改后实测

- 深色档三处（看板根面/顶栏、市场根面/顶栏/内容区）与「新对话」顶部/内容区逐值相同 `#111314`。
- 浅色档逐值未变 `#FFFFFF`（全图逐像素差异 0.01%，仅 mock 卡片时间戳「今天 13:44」→「今天 13:46」
  随真实时间前进；看板浅色 0.02% 同因）；参照面 `.chat-header`/`.chat-container`/`.messages-container`
  改前改后 computed 逐项相同。
- **顺带变深（同一改动的必然结果，需她确认是否接受）**：看板列区那层 `rgba(255,255,255,.06)` 叠层
  落地色由 `#262728` → `#1F2122`（半透明白叠在更深的根面上）；列头色块与卡片（不透明 `#27292B`）
  未变。市场整页无此类叠层。
- 全轮 0 `pageerror`；桌面预览 1440×960 / DPR 2。

### ⑤ 残留 / 备用触发语（未授权）

- 「顶栏下沿的分隔线也一起对齐」：看板/市场顶栏深色描边为 `rgba(255,255,255,.12)`（落在 `#111314`
  上≈`#2E3031`），对话顶栏 1px 边为 `#34393C` —— 同底色后两者略有差；她本轮只说背景色，未动。
- 「列区那层太暗了」：见 ④ 的 `#1F2122`；要恢复原亮度需给该叠层单独提高透明度或换实色。
- 「设置页背景也一起改」：`.settings-page` 自己仍画 editor-background（真机是独立 webview；8899
  的 IDE 版设置页 mock 已按她要求移除），本轮未动。
- 「右侧面板也一起改」：右 pane 面（`--cc-bg-inspector` = editor-background）未动，她未点名。

### 验证脚本与证据

- `CC02/走查/_tools/0921/probe-board-market-header-bg-0921.mjs`（新对话 / 看板 / 市场三步 ×
  浅深两档：顶栏、内容区、被评论四处的 computed 底色 + 沿祖先链实际画上去的色 + 底边描边）。
- `CC02/走查/_tools/0921/compose-board-market-bg-0921.py`（并集裁切 + 标注改前/改后与实测值；
  输出目录已存在即拒绝，不覆盖旧证据）。
- `CC02/走查/_tools/0921/diff-shots-0921.py`（全图逐像素差异 + 差异框）。
- 数据与图：`CC02/走查/0921-board-market-bg/{before,after}-desktop-*-board-market-bg.json|png`；
  交付页 `CC02/走查/0921-board-market-bg-report/index.html`（母版 v1.1，本地绝对路径打开）。

## 0921 评论③（设置页下拉列表：原生弹层 → 自绘 listbox，落在触发器下方 2px / 右对齐 / 同宽）

### ① 她的原话与「原生做不到」

设计师原话：「这种类型的选择器点击后的下拉列表应该出现在选择器下方 2px 的位置，右对齐，
下拉列表的宽度和选择器尽量保持一致」。

前两轮（评论①/②）改的是 `.settings-select` **自身**的外观（左右内衬、三角矢量与方向）；本轮点名的是
**点击后弹出的那个列表**——而它由系统/Chromium 绘制（`appearance: none` 只改控件本体，弹层是
独立窗口/原生菜单），**位置、对齐、宽度都无法由 CSS 控制**。故本轮必须把设置页这两颗下拉从
原生 `<select>` 换成自绘 listbox（不是纯 CSS 调整）。

### ② 实现（新组件 `SettingsSelect.tsx` + 宿主分叉）

- **组件**：`packages/webview/src/components/SettingsSelect.tsx`。分发器 + 两个内部分支：
  - 桌面端（`isDesktopHost()`）→ `<button class="settings-select-trigger">` + 自绘
    `<div role="listbox">` / `<div role="option" aria-selected>`；
  - IDE 宿主 → 原封不动的原生 `<select class="settings-select">`（宿主原生弹层 + 既有
    e2e `selectOption(...)` / 单测 `.settings-select`·`queryByRole("combobox")` 断言零改动）。
- **键盘模型**：复用仓库内核 `useRovingMenu`（roving tabindex / Arrow 不循环 / Enter·Space 激活 /
  Escape 关闭并回焦触发器 / Tab 只关不激活 / 点外部关闭），与 SSH 主机、工作目录、权限模式下拉同源。
  两处实现细节：`closeOnActivate: true`（默认是关：那是给「添加主机…」这种就地展开的菜单留的）、
  打开时聚焦**当前选中项**（`openMenu(selectedIndex)`，与基准分支下拉同习惯）。
- **定位**：`position: fixed` + 触发器 `getBoundingClientRect()` 内联样式 ——
  `top = 触发器下缘 + 2`、`right = 视口宽 − 触发器右缘`、`width = 触发器宽`。
  必须是 fixed：卡片 `.settings-card{overflow:hidden}` 会裁掉 absolute 弹层（仓库无 portal，
  弹层逃出 `overflow` 的既有做法就是 fixed）。滚动时跟随重算（`scroll` 捕获 + `resize`）。
- **观感**：与本文件弹层家族（`.more-menu`/`.desktop-session-menu`/`.desktop-workdir-menu`）取同一组值 ——
  浅色 白面 / `#EBEEF5` 边 / r12 / `0 0 12px 12%` 柔影 / 容器 `padding: 8px` / 项 `28px`·`r6`·`14px`·`400`；
  hover `#EEF0F3`+`#1F2329`、选中 `#E7E9ED`+`#1F2329`（pressed，与权限模式/面板切换菜单一致，无对号）；
  深色 `--cc-bg-overlay` `#232526` / 12% 白边 / 40% 黑柔影 / 项 `#9A9EA5`、hover 8% 白、选中 12% 白。
- **新增：键盘焦点环**（同族弹层此前没有）。roving 会把真实焦点放到选项上，
  故补 `:focus-visible { outline: 2px solid var(--cc-border-focus); outline-offset: -2px }`
  （环内收 2px 免得被弹层圆角切角；鼠标点击不亮）。axe 结构规则同轮复扫通过。
- **触发器**：与原生 select 共用同一条控件盒规则（`SettingsPage.css` 的
  `.settings-select, .settings-select-trigger, .settings-number-input, .settings-text-input`：
  260×32 / r6 / 1px `--vscode-input-border` / `--vscode-input-*` 色 / 14px），并复用同一条三角规则
  （`.settings-select-trigger::after` 与 `.settings-control:has(> .settings-select)::after` 并列，
  矢量只写一份；触发器那条 `right: 8px` 即「距内缘 8px」，原生那条因包含块是 border box 故 9px）。
  焦点沿用原生 select 的 `:focus` + `var(--vscode-focusBorder)`（**不是** `:focus-visible`）——
  输入类控件按桌面既有「两种焦点语言」鼠标点也算，替换后焦点行为与改前逐值一致。
- **一处兜底**：`value` 不在选项里时控件显示**第一项**（原生 select 就是这么渲染 `selectedIndex = -1` 的），
  避免出现空白控件。调试点：8899 原型 mock 的语言值是 `"zh"`（不在选项集里，见
  `prototype/mockShared.ts`，属另一窗口的未提交 mock 文件本轮未动），真机是 `"" | "zh-CN" | "en-US"`。
- 弹层的桌面皮肤写在 `host-desktop.css` 末尾新增块（`[data-host="desktop"] .settings-select-menu` 一族，
  浅深两档自带），未改动既有 13 个弹层家族的规则，避免牵连同族组件。

### ③ 改后实测（`CC02/走查/0921-settings-dropdown/dropdown-0921.json`）

- **几何三则**（浅/深两档 × 语言/主题两颗下拉，四组数据全同）：`下缘间距 = 2.0`、
  `右缘差 = 0.0`、`宽度差 = 0.0`（弹层 260×74，与触发器 260×32 同宽同右缘）。
- **弹层观感**：浅 `#FFFFFF`/`#EBEEF5`/`12px`/`0 0 12px rgb(0 0 0/12%)`/`padding 8px`；
  深 `#232526`/`rgba(255,255,255,.12)`/`40%`；项 242×28 / r6 / 14px / 400。
  hover 浅 `#EEF0F3`+`#1F2329`、深 8% 白+`#FFFFFF`；选中 浅 `#E7E9ED`+`#1F2329`、深 12% 白+`#FFFFFF`。
- **触发器**：260×32 / r6 / 静止边 浅 `#DCDFE6` 深 `#414649` / 聚焦边 浅 `#1F2329` 深 `#A0A5A8` /
  `padding 4px 24px 4px 8px` / 三角 8×4.5 距内缘 8px —— 与改前原生 select **逐值相同**。
- **像素级 parity**：同一用例、同一 1440×1000@2x、同一「AI 回复语言」行元素截图，
  与改前（评论②状态）**差异 0 像素**（浅深两档各 227752 px 全同）——
  触发器是原 select 的 1:1 替换，行高与内衬零位移。
- **交互**：Enter 打开并聚焦当前项 → ArrowDown 移动 → Enter 选中并关闭 + 焦点回触发器（标签随值更新）
  → Tab 只关不激活 → Escape 关闭回焦 → 点行标题（容器外）关闭 → 打开时滚动内容区，弹层跟随
  （下缘间距仍 2.0、右缘差 0.0）。
- **宿主分叉**：桌面端 `select.settings-select` 0 个 / 触发器 2 个；把 `waveHostType` 改成非 desktop
  重渲染后 2 个原生 select 回来、触发器 0 个（选项共 5 个）。
- **axe**（`/tmp/axe`，只扫触发器 + 弹层）：浅/深两档 `violations: []`、`passes: 5`
  （aria-required-children / aria-required-parent / aria-allowed-attr / nested-interactive / color-contrast）。
- 全轮 0 `pageerror`。

### ④ 宿主范围 / 残留（未授权）

- **本轮只改桌面端**：IDE 宿主保留原生 `<select>`（弹层交宿主原生实现），因此四个既有测试文件
  （`settings-unset-placeholder.e2e.ts`、`settings-save-feedback.e2e.ts`、`settings-org-managed-keys.e2e.ts`
  的 `selectOption`、`model-status-login-commands.test.tsx` 的 `.settings-select`、
  `settingsServerConfig.test.tsx` 的 `combobox`）**无需改动**。触发语：「IDE 宿主也改成自绘」。
- 触发语：「下拉列表的圆角跟随触发器（改成 6px）」（现取弹层家族 r12）；
  「选项行高跟设置页控件对齐（28 → 32）」；
  「下拉也加上打开动画」（家族成员目前都没有入场动画）；
  「触发器焦点只要键盘亮」（现与原生 select 同：鼠标点也亮）；
  「其他下拉（会话筛选/看板等）也换成这个自绘组件」——`SessionBoard.tsx` 的筛选仍是
  「透明原生 select + 自绘外壳」，其弹层仍是原生。

### 验证脚本与证据

- `CC02/走查/_tools/0921/probe-settings-dropdown-0921.mjs`（①宿主分叉 ②浅深两档几何/观感/触发器
  ③悬停态 ④键盘全路径 ④b 主题下拉选中态与焦点环 ⑤点外部 + 滚动跟随 ⑥axe 双档 ⑦IDE 宿主回归）。
- `CC02/走查/_tools/0921/shot-trigger-row-0921.mjs` + `diff-shots-0921.py`（行级像素 parity 对照）。
- 数据与图：`CC02/走查/0921-settings-dropdown/dropdown-0921.json`、
  `dropdown-{light,dark}-2x.png`（触发器 + 弹层）、`dropdown-theme-light-2x.png`（选中态 + 焦点环）、
  `parity-row-{light,dark}-2x.png`（与 `0921-settings-select/caret-row-*-2x.png` 逐像素 0 差异）。

## 0921 评论（承上：看板 / 市场顶栏下沿分隔线也对齐对话顶栏）

她在我上一节的四条底色对齐后追加一条：「顶栏下沿的分隔线也一起对齐」。

### ① 实测：同一层 12% 白，落在更深的底色上就淡了一档

同一次运行、DPR2 截图在 CSS `y=43`（顶栏 44px 盒的底边那一行，描边只有 1px）按 1:1 取色：

| 面（深色）             | 原始态    | 底色对齐后（上一节交付态） | 本轮修正后    |
| ---------------------- | --------- | -------------------------- | ------------- |
| 新对话顶栏下沿（参照） | `#34393C` | `#34393C`（未动）          | `#34393C`     |
| 会话状态看板顶栏下沿   | `#343637` | **`#2E3031`**              | **`#34393C`** |
| 插件市场整页顶栏下沿   | `#343637` | **`#2E3031`**              | **`#34393C`** |
| 三处（浅色）           | `#EBEEF5` | `#EBEEF5`                  | `#EBEEF5`     |

即：底色变深后，原来那层 `rgba(255,255,255,.12)` 的合成色从 `#343637` 掉到 `#2E3031`，
与对话顶栏的 `#34393C` 差开 —— 所以这条是上一节改动的**连带后果**，不是独立缺陷。

### ② 改法（`SessionBoard.css` 深色覆盖一行）

```css
[data-host="desktop"][data-theme="dark"] .session-board-toolbar {
  border-bottom-color: var(--vscode-widget-border, #34393c);
}
```

- 对话顶栏 `.chat-header` 的底边本来就取 `--vscode-widget-border`（桌面深色档映射到
  `--cc-border-light` = `#34393c`），改为同一 token 即「永远跟随对话顶栏」，不再写死半透明白。
- 市场整页顶栏复用同一类名 `.session-board-toolbar`（看板壳类），故**一处改动同时覆盖两个面**。
- 浅色档 base 本就是 `#ebeef5`，与浅色对话顶栏（`host-desktop.css` 显式钉的 `#ebeef5`）本来就同值，
  **未动**。

### ③ 残留 / 备用触发语（未授权）

- 「顶栏里那条竖分割线也一起」：`.session-board-toolbar-divider`（图标组与返回钮之间 1×16 的竖线）
  深色仍是 `rgba(255,255,255,.12)`，与刚改的下沿不同族（竖线本来就不该等同横线）。
- 「下沿线再淡一点 / 再重一点」：现在与对话顶栏逐值相同（`#34393C`）；要单独调需给新值。

### 验证脚本与证据

- `CC02/走查/_tools/0921/probe-board-market-header-bg-0921.mjs`（三面 × 浅深：底色 computed +
  实际画上去的色 + 底边描边色）。
- `CC02/走查/_tools/0921/compose-board-market-bg-0921-v2.py`（面底 1:1 对照 + 1px 描边的
  **4× 最近邻放大**对照：参照 / 看板 / 市场三行并列，输出目录已存在即拒绝）。
- 数据与图：`CC02/走查/0921-board-market-bg/{before,after,after2}-desktop-*-board-market-bg.json|png`
  （`after` = 只对齐底色、`after2` = 底色 + 描边都对齐）；交付页
  `CC02/走查/0921-board-market-bg-report-v2/index.html`（母版 v1.1，四条，含 B-04 描边放大对照）。
