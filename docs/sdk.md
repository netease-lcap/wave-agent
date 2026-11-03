# Agent SDK

把 agent 嵌进你自己的 Node.js 程序：模型调用、工具执行、权限判定、会话持久化、记忆、插件都由 SDK 负责，你只需发出消息、接住回调。

::: tip 本页只写核心用法
SDK 源码开放、JSDoc 完善。`AgentOptions`、`AgentCallbacks`、`ToolPlugin`、`PermissionDecision` 这类逐字段细节不在本页维护副本——副本必然落后于代码。需要精确的选项、方法签名或返回结构时，直接读 `packages/agent-sdk/src`：人或 AI 打开对应文件即可，编辑器悬停看到的也是同一份注释。
:::

## 1. 快速开始 {#quick-start}

### 安装 {#install}

```bash
npm install wave-agent-sdk
```

需要 Node.js >= 22。

### 最小示例 {#basic-usage}

```typescript
import { Agent } from "wave-agent-sdk";

const agent = await Agent.create({
  model: "gpt-4",
  apiKey: process.env.WAVE_API_KEY,
  baseURL: "https://api.example.com/v1",
  workdir: "/path/to/project",
  callbacks: {
    onAssistantContentUpdated: ({ chunk }) => process.stdout.write(chunk),
  },
});

await agent.sendMessage("帮我写一个排序算法");

await agent.destroy();
```

`Agent.create()` 是唯一的构造入口（异步工厂）。一个 Agent 实例对应一个会话，多会话就多实例。

## 2. 核心用法 {#core-usage}

### 生命周期 {#lifecycle}

- **`Agent.create(options)`** — 异步完成初始化：读配置、加载记忆、连 MCP、发现技能与插件。返回即可用。
- **`sendMessage(content)`** — 把用户消息推进队列。正在处理时消息排队，按入队顺序后续处理；`abortAIMessage()` 中止当前响应。
- **`destroy()`** — 终态收敛：中止进行中的响应、停掉后台任务与子代理、关 MCP 连接与文件监听、排空已注册的存活异步工作后才返回。之后调用公开 API 会抛 `Agent destroyed`（不静默丢弃），重复调用是安全 no-op。

长驻进程（CLI、插件、桌面端）在退出、切换会话时统一走 `destroy()`，不要只靠 GC。

### 接住输出 {#callbacks}

响应通过回调推送，`chunk` 是**增量片段**（不是累积值），消费端自行累积。工具块、提示行、压缩摘要、后台任务各自另有回调：

```typescript
callbacks: {
  onAssistantContentUpdated: ({ messageId, chunk, stage }) => {
    // stage: "streaming" | "end"
    append(messageId, chunk);
  },
  onAssistantReasoningUpdated: ({ chunk }) => {
    appendReasoning(chunk);
  },
  onToolBlockUpdated: (block) => {
    // 工具开始/结束、输出更新
  },
}
```

全部回调见 `AgentCallbacks`（消息、工具块、子代理、MCP、后台任务、UI 状态六组）。UI 层做渲染时通常还需要 `onLoadingChange`、`onPermissionModeChange` 与 `onQueuedMessagesChange`。

### 工具与权限 {#tools-permissions}

内置工具（Bash / Read / Write / Edit / Glob / Grep / LSP / WebFetch 等）默认全部可用。`tools` 传白名单收窄（`[]` 即全部关闭），`customTools` 注册自己的工具：

```typescript
import { Agent, buildTool } from "wave-agent-sdk";

const myTool = buildTool({
  name: "MyTool",
  description: "查询内部知识库",
  parameters: {
    query: { type: "string", description: "检索关键词" },
  },
  required: ["query"],
  execute: async ({ query }, context) => {
    return { success: true, content: `结果: ${query}` };
  },
});

const agent = await Agent.create({ customTools: [myTool] });
```

权限判定统一由 `permissionMode` 与规则决定：

| 模式                | 行为                                 |
| ------------------- | ------------------------------------ |
| `default`           | 危险操作询问用户                     |
| `acceptEdits`       | 自动接受文件编辑                     |
| `plan`              | 只读调研，除计划文件外不许写         |
| `dontAsk`           | 不询问：未命中规则的受限工具直接拒绝 |
| `bypassPermissions` | 全部放行（仅隔离环境使用）           |

需要自己接管问询时传 `canUseTool`，它拿到的是权限上下文、返回的是判定结果：

```typescript
canUseTool: async ({ toolName, toolInput, permissionMode }) => {
  if (toolName === "Bash") return { behavior: "deny", message: "禁用 shell" };
  return { behavior: "allow" };
};
```

规则（`allowedTools` / `disallowedTools`，或写进 settings.json）用 `Tool` 或 `Tool(pattern)` 表达，规则细节见[功能规格说明：工具权限系统](/specs/core/tool-permission-system)。

### 会话与恢复 {#sessions}

会话以 JSONL 存在 `~/.wave/projects/<项目编码>/`（按工作目录隔离，子代理单独文件），压缩后通过 `parentSessionId` 链接旧会话。恢复有三种入口：

```typescript
// 创建时恢复指定会话 / 继续最近一次
await Agent.create({ restoreSessionId: "session-id", workdir });
await Agent.create({ continueLastSession: true, workdir });

// 运行时切换
await agent.restoreSession("another-session-id");

// 不进 Agent 也能查：listSessions / loadSessionFromJsonl / getSessionFilePath / deleteSession
```

保留期与清理策略见[功能规格说明：会话保留](/specs/core/session-retention)。

### 配置来源 {#config-sources}

同一条配置有多个来源，优先级由高到低：`AgentOptions` → 企业托管下发 → 项目 `.wave/settings.local.json` → 项目 `.wave/settings.json` → 用户 `~/.wave/settings.json` → 环境变量兜底（`WAVE_MODEL`、`WAVE_API_KEY` 等）。settings.json 的改动手工保存后在下一轮生效，无需重启，例外项见[功能规格说明：Agent 配置](/specs/core/agent-config)。

## 3. 公开入口 {#entrypoints}

| 入口                       | 给谁用                         | 内容                                                     |
| -------------------------- | ------------------------------ | -------------------------------------------------------- |
| `wave-agent-sdk`           | 进程内嵌 agent（CLI 这类）     | 完整能力：`Agent`、工具、会话、记忆、插件                |
| `wave-agent-sdk/host`      | 通过 JSON-RPC 驱动子进程的宿主 | `StdioAgent`、`NotificationRouter`、共享字面量与协议类型 |
| `wave-agent-sdk/types`     | 纯 UI / 仅需类型               | 消息与协议类型（类型擦除，零运行时）                     |
| `wave-agent-sdk/constants` | 纯 UI / 仅需常量               | 工具名等共享字面量                                       |

宿主请只从 `/host` 取——桶入口会把整套运行时（工具、供应商 SDK、可选原生包）连进宿主进程，代价是启动体积与求值期崩溃风险。

## 4. 想看细节 {#read-the-source}

`packages/agent-sdk/src` 的目录即分层：

| 想知道                 | 直接读                                     |
| ---------------------- | ------------------------------------------ |
| 一次回合怎么跑         | `managers/aiManager.ts`                    |
| 工具怎么注册、怎么执行 | `managers/toolManager.ts`、`src/tools/`    |
| 权限为什么这样判       | `managers/permissionManager.ts`            |
| 会话文件格式与恢复     | `services/session.ts`                      |
| 记忆怎么加载与注入     | `services/memory.ts`                       |
| 宿主与子进程的协议     | `src/stdio/`、`src/types/stdioProtocol.ts` |
