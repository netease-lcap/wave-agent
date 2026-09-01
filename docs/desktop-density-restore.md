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
