# 功能规格说明：IDE 插件

**规格文件**：`docs/specs/ui/ide-plugin.md`
**特性分支**：`ide-plugin`
**创建日期**：2026-07-27

> 本规格覆盖 VS Code 扩展与 JetBrains 插件共享的 React webview 中、未被其它 CLI 优先规格覆盖的横切关注点：主题与外观变量、共享 webview 包与构建产物同步、webview 生命周期与消息协议、IDE 专属对话框组件。已由其它规格覆盖的部分（确认对话框见 [确认 UI](confirm-ui.md)、登录流程见 [SSO 认证](../enterprise/sso-auth.md)、编辑器插件与 wave 进程的通信见 [Stdio 传输层](stdio-transport.md)）不在此重复。

## 用户场景与测试 *（必填）*

### 用户故事 1 - 与宿主主题一致的外观（优先级：P1）

作为用户，我希望在 VS Code 或 JetBrains IDE 中打开 Wave 面板时，聊天界面自动跟随当前 IDE 的浅色/深色主题，字体、背景、输入框、按钮与列表选中色都与宿主一致，以便界面不显得突兀。

**优先级原因**：主题一致性是嵌入式面板的基本观感要求，直接影响用户对插件完成度的第一印象。

**独立测试**：在 VS Code 中切换深色/浅色主题验证面板跟随；在 IntelliJ 中切换 Darcula/Light 主题并验证面板在 LaF 变更后无需重载即重新着色。

**验收场景**：

1. **假设** VS Code 处于深色主题，**当**用户打开 Wave 面板时，**则**面板背景、正文、输入框、按钮背景使用 VS Code 注入的对应 `--vscode-*` 变量值。
2. **假设** IntelliJ 处于 Darcula，**当** Wave 面板加载时，**则** JetBrains 从当前 LaF 派生关键 `--vscode-*` 变量并注入，面板与 IDE 面板/编辑器配色一致。
3. **假设** 面板已加载，**当**用户在 IDE 中切换浅色/深色主题时，**则** JetBrains 重新计算并注入 LaF 覆盖与对应主题基线，面板即时换肤而不整页重载。

---

### 用户故事 2 - 单一 React 源、双宿主构建产物（优先级：P1）

作为开发者，我希望 webview 的 React 源码只维护一份（`packages/webview/src/`），VS Code 扩展与 JetBrains 插件各自消费其构建产物，以便一处改动两处生效、避免双份 UI 漂移。

**优先级原因**：单一真源是双宿主 webview 可维护性的根基；任何分叉都会导致行为不一致与重复劳动。

**独立测试**：修改 `packages/webview/src/` 中一个组件，重新构建 webview，验证 VS Code 与 JetBrains 两侧面板均反映改动；检查 `packages/vsce/webview/` 与 JetBrains 资源目录均属构建产物而非手编源。

**验收场景**：

1. **假设** `packages/webview/src/` 是唯一手编 React 源，**当**执行 webview 构建时，**则**产物同步到 VS Code 与 JetBrains 的 webview 资源目录。
2. **假设** 开发者直接编辑了 `packages/vsce/webview/` 下文件，**当**下一次构建时，**则**该改动被构建产物覆盖——构建产物目录不可手编。

---

### 用户故事 3 - 稳定的 webview 生命周期与消息协议（优先级：P1）

作为用户，我希望面板在加载初期就能可靠地把消息发给宿主、并接收宿主下发的指令（流式块、工具块、确认、模式切换等），即便 React 早于宿主桥就绪挂载也不会丢消息。

**优先级原因**：消息通道是 webview 全部交互的基座；加载竞态丢消息会表现为"面板开了但不动"这类难排查故障。

**独立测试**：在 JetBrains 中观察面板加载：React 先于 Kotlin 注入 `__wavePostMessage` 时，早期 `postMessage` 应被排队并在桥就绪后冲刷；VS Code 中验证 `acquireVsCodeApi()` 仅调用一次。

**验收场景**：

1. **假设** webview 加载，**当**入口脚本执行时，**则** `acquireVsCodeApi()` 在整个生命周期内仅被调用一次并持有实例。
2. **假设** JetBrains 桥尚未就绪，**当** webview 早期发送消息时，**则** shim 将其入队；桥就绪后自动冲刷队列。
3. **假设** 宿主向 webview 下发指令（如 `SET_MESSAGES`、`UPDATE_STREAMING_CONTENT`），**当**指令到达时，**则** reducer 按动作类型更新状态并触发对应渲染。

---

### 用户故事 4 - IDE 专属对话框组件（优先级：P2）

作为用户，我希望在面板内能查看版本/会话/模型运行时信息（Status 对话框）、配置语言（Config 对话框）、看到首次引导（Welcome 视图），并以一致的对话框视觉规范呈现，以便这些 IDE 独有能力有统一的入口与外观。

**优先级原因**：这些组件 CLI 侧已有等价能力（Ink 渲染），但 webview 侧属 IDE 专属、需自有布局规范；统一对话框模式降低维护成本。

**独立测试**：逐个触发对话框（Status/Config/Welcome 及 MCP/插件/后台任务/Workflow 管理器），验证共用布局类与遮罩/关闭行为一致；验证其消费 reducer 状态字段。

**验收场景**：

1. **假设** 用户打开 Status 对话框，**当**对话框渲染时，**则**显示版本、会话 ID、cwd、模型、运行时信息，且复用共享对话框布局类。
2. **假设** 对话框已打开，**当**用户按 ESC 或点击遮罩时，**则**对话框关闭并恢复输入焦点。
3. **假设** 用户打开 Welcome 视图，**当**未认证或无会话时，**则**显示引导与登录入口；登录后视图消失。

---

### 边界情况

- **JetBrains JCEF 不随 IDE LaF 变更自动重新着色怎么办？** 宿主订阅 `LafManagerListener`，在 LaF 变更时通过 `bridge.runJavaScript()` 注入刷新脚本，重写 LaF 覆盖样式与主题基线样式。
- **JetBrains 无法从 jar 内直接加载 webview 资源怎么办？** 将 `chat.js`/`chat.css`/`vscode-shim.js` 解包到临时目录，以 `file://` 加载 `index.html`，使页面获得 `file://` 源以自由加载同源兄弟资源。
- **`acquireVsCodeApi()` 被重复调用怎么办？** shim 在已获取后抛错；VS Code 原生同样仅允许一次。入口只调用一次并向下传 props。
- **React 在宿主桥就绪前发送消息怎么办？** JetBrains shim 将消息入队并轮询 `__wavePostMessage`，就绪后冲刷；不丢消息。
- **某个组件用了 webview 自定义变量但宿主未提供怎么办？** 以 CSS fallback 值兜底（如 `var(--wave-blue, #75beff)`），保证未注入时仍有可用外观。

## 需求 *（必填）*

### 功能需求

#### 主题与外观

- **FR-001**：webview 必须仅通过 `--vscode-*` CSS 自定义变量消费宿主主题色，不在组件样式中硬编码主题色（允许带 fallback 值）。
- **FR-002**：VS Code 宿主必须由扩展将 `--vscode-*` 变量注入 webview（VS Code 原生能力），webview 无需自备主题表。
- **FR-003**：JetBrains 宿主必须从当前 IntelliJ LaF 读取关键颜色（背景、前景、输入、按钮、边框、链接、悬停、列表选中、代码块背景、次级按钮等），生成 `--vscode-*` 覆盖并注入到 `:root`。
- **FR-004**：JetBrains 宿主必须提供主题基线样式表（深色 `theme-base.css`、浅色 `theme-base-light.css`），承载 80+ 未被 LaF 覆盖覆盖的 `--vscode-*` 变量，使缺省主题完整。
- **FR-005**：JetBrains 宿主注入顺序必须为主题基线在前、LaF 覆盖在后，使 LaF 派生值经层叠优先胜出。
- **FR-006**：当 IDE LaF 变更时，JetBrains 宿主必须重新计算 LaF 覆盖与对应主题基线（深/浅随亮/暗翻转），并通过运行时脚本重写对应 `<style>` 元素文本，不整页重载。
- **FR-007**：JetBrains 宿主必须从 LaF 读取字体族名并注入 `--vscode-font-family` 与 `--vscode-editor-font-family`，使面板字体与宿主一致。
- **FR-008**：webview 可定义少量 `--wave-*` 自定义变量（如 `--wave-blue`），但每处使用必须带 fallback 值，保证宿主未注入时仍可用。

#### 共享 webview 包与构建产物

- **FR-009**：`packages/webview/src/` 必须是 webview 唯一手编 React 源；VS Code 与 JetBrains 均消费其构建产物而非各自维护源。
- **FR-010**：`packages/vsce/webview/` 与 JetBrains 资源目录下的 webview 文件必须为构建产物，禁止手编；任何源改动只能落在 `packages/webview/src/`。
- **FR-011**：修改 `packages/webview/src/` 后必须重新构建 webview，产物方可同步至各宿主资源目录并被依赖包使用。
- **FR-012**：JetBrains 宿主必须将 webview 构建产物（`chat.js`、`chat.css`、`vscode-shim.js`）打包进插件资源，运行时解包到临时目录并以 `file://` 加载。

#### webview 生命周期与消息协议

- **FR-013**：webview 入口必须在生命周期内仅调用一次 `acquireVsCodeApi()`，将所得实例作为 prop 向下传递，不得在各组件中重复获取。
- **FR-014**：JetBrains 宿主必须提供 `vscode-shim.js` 实现 `acquireVsCodeApi`：返回 `postMessage`/`getState`/`setState`，并在已获取后再次调用时抛错。
- **FR-015**：shim 必须在宿主桥（`__wavePostMessage`）就绪前将早期 `postMessage` 入队，桥就绪后自动冲刷队列，不丢消息。
- **FR-016**：宿主→webview 方向，JetBrains 必须经 `__waveReceive` 将 JSON 字符串解析并派发为 `MessageEvent('message')`，复用 webview 既有的 `message` 监听器。
- **FR-017**：webview 必须以单一 reducer 集中处理宿主下发的动作类型（消息、流式、工具块、确认、对话框、会话、任务、权限模式、配置、认证等），动作类型命名采用大写下划线常量。
- **FR-018**：webview 必须在挂载后向宿主发送就绪信号，宿主据此开始下发初始状态与流式更新。

#### IDE 专属对话框组件

- **FR-019**：Status 对话框必须显示版本、会话 ID、cwd、模型与运行时信息，数据来源于 reducer 状态。
- **FR-020**：Config 对话框必须仅显示 IDE 侧可配置字段（如语言）；`/model` 命令不得在 IDE 出现，模型选择不属 IDE 配置范围。
- **FR-021**：Welcome 视图必须在未认证或无会话时显示引导与登录入口，认证/有会话后消失。
- **FR-022**：IDE 专属对话框（Status、Config、Welcome、MCP、插件、后台任务、Workflow、会话列表等）必须复用共享对话框布局类与遮罩/ESC 关闭行为，不得各自重写视觉骨架。
- **FR-023**：确认对话框与登录对话框的规格分别由 [确认 UI](confirm-ui.md) 与 [SSO 认证](../enterprise/sso-auth.md) 承载，本规格不重复定义其行为。

### 关键实体 *（涉及数据时填写）*

- **WebviewState**：reducer 维护的单一状态树（消息、流式、任务、确认、对话框、会话、权限模式、配置、认证等）。
- **WebviewAction**：宿主下发或组件派发的动作对象，含 `type` 与负载；类型为约定的大写下划线常量。
- **HostBridge**：宿主注入的 `acquireVsCodeApi()` 返回对象（`postMessage`/`getState`/`setState`），VS Code 原生、JetBrains 由 shim 提供。
- **ThemeLayer**：主题样式分层——VS Code 原生 `--vscode-*` 注入；JetBrains 为「主题基线（深/浅）+ LaF 覆盖」双层 `:root` 样式，LaF 覆盖经层叠胜出。
