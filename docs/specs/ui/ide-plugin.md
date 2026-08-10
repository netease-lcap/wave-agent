---
name: "IDE 插件"
description: "VS Code/JetBrains 共享 React webview 的横切关注点：主题变量、共享包与构建产物、生命周期与消息协议、IDE 专属对话框"
order: 230
---

# 功能规格说明：IDE 插件

**规格文件**：`docs/specs/ui/ide-plugin.md`
**创建日期**：2026-07-27

> 本规格覆盖 VS Code 扩展与 JetBrains 插件共享的 React webview 中、未被其它 CLI 优先规格覆盖的横切关注点：主题与外观变量、共享 webview 包与构建产物同步、webview 生命周期与消息协议、IDE 专属对话框组件。已由其它规格覆盖的部分（确认对话框见 [确认 UI](confirm-ui.md)、登录流程见 [SSO 认证](../enterprise/sso-auth.md)、编辑器插件与 wave 进程的通信见 [Stdio 传输层](stdio-transport.md)）不在此重复。

## 用户场景与测试 *（必填）*

### 用户故事：与宿主主题一致的外观（优先级：P1）

作为用户，我希望在 VS Code 或 JetBrains IDE 中打开 Wave 面板时，聊天界面自动跟随当前 IDE 的浅色/深色主题，字体、背景、输入框、按钮与列表选中色都与宿主一致，以便界面不显得突兀。

**优先级原因**：主题一致性是嵌入式面板的基本观感要求，直接影响用户对插件完成度的第一印象。

**独立测试**：在 VS Code 中切换深色/浅色主题验证面板跟随；在 IntelliJ 中切换 Darcula/Light 主题并验证面板在 LaF 变更后无需重载即重新着色。

**验收场景**：

1. **假设** VS Code 处于深色主题，**当**用户打开 Wave 面板时，**则**面板背景、正文、输入框、按钮背景使用 VS Code 注入的对应 `--vscode-*` 变量值。
2. **假设** IntelliJ 处于 Darcula，**当** Wave 面板加载时，**则** JetBrains 从当前 LaF 派生关键 `--vscode-*` 变量并注入，面板与 IDE 面板/编辑器配色一致。
3. **假设** 面板已加载，**当**用户在 IDE 中切换浅色/深色主题时，**则** JetBrains 重新计算并注入 LaF 覆盖与对应主题基线，面板即时换肤而不整页重载。

---

### 用户故事：单一 React 源、双宿主构建产物（优先级：P1）

作为开发者，我希望 webview 的 React 源码只维护一份（`packages/webview/src/`），VS Code 扩展与 JetBrains 插件各自消费其构建产物，以便一处改动两处生效、避免双份 UI 漂移。

**优先级原因**：单一真源是双宿主 webview 可维护性的根基；任何分叉都会导致行为不一致与重复劳动。

**独立测试**：修改 `packages/webview/src/` 中一个组件，重新构建 webview，验证 VS Code 与 JetBrains 两侧面板均反映改动；检查 `packages/vscode/webview/` 与 JetBrains 资源目录均属构建产物而非手编源。

**验收场景**：

1. **假设** `packages/webview/src/` 是唯一手编 React 源，**当**执行 webview 构建时，**则**产物同步到 VS Code 与 JetBrains 的 webview 资源目录。
2. **假设** 开发者直接编辑了 `packages/vscode/webview/` 下文件，**当**下一次构建时，**则**该改动被构建产物覆盖——构建产物目录不可手编。

---

### 用户故事：稳定的 webview 生命周期与消息协议（优先级：P1）

作为用户，我希望面板在加载初期就能可靠地把消息发给宿主、并接收宿主下发的指令（流式块、工具块、确认、模式切换等），即便 React 早于宿主桥就绪挂载也不会丢消息。

**优先级原因**：消息通道是 webview 全部交互的基座；加载竞态丢消息会表现为"面板开了但不动"这类难排查故障。

**独立测试**：在 JetBrains 中观察面板加载：React 先于 Kotlin 注入 `__wavePostMessage` 时，早期 `postMessage` 应被排队并在桥就绪后冲刷；VS Code 中验证 `acquireVsCodeApi()` 仅调用一次。

**验收场景**：

1. **假设** webview 加载，**当**入口脚本执行时，**则** `acquireVsCodeApi()` 在整个生命周期内仅被调用一次并持有实例。
2. **假设** JetBrains 桥尚未就绪，**当** webview 早期发送消息时，**则** shim 将其入队；桥就绪后自动冲刷队列。
3. **假设** 宿主向 webview 下发指令（如 `SET_MESSAGES`、`UPDATE_STREAMING_CONTENT`），**当**指令到达时，**则** reducer 按动作类型更新状态并触发对应渲染。

---

### 用户故事：IDE 专属对话框组件（优先级：P2）

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

