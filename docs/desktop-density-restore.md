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

预览评论 `span.preview-pane-url`「http://localhost:8899/」：「这个地址前面不显示图标，字号等参考设计稿」（Figma 13438-7439）。

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
