---
title: 工具系统
description: 内置工具清单与逐个参数说明、自定义 ToolPlugin、工具权限规则与工具名常量
---

# 工具系统 {#tool-system}

## 内置工具清单 {#builtin-tools}

Wave 提供 25 个内置工具，涵盖代码探索、文件操作、任务管理、网页抓取和定时任务等能力。

### 文件操作

| 工具    | 说明                                        |
| ------- | ------------------------------------------- |
| `Read`  | 读取文件内容，支持图片读取和二进制检测      |
| `Write` | 写入文件（已存在文件需先 Read）             |
| `Edit`  | 精确字符串替换，支持 `replace_all` 批量替换 |

### 代码搜索与智能

| 工具   | 说明                                                 |
| ------ | ---------------------------------------------------- |
| `Glob` | 文件名模式匹配（如 `**/*.ts`）                       |
| `Grep` | 正则表达式内容搜索（基于 ripgrep）                   |
| `LSP`  | 代码智能（跳转定义、查找引用、悬停信息、符号搜索等） |

### 执行与交互

| 工具              | 说明                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Bash`            | 终端命令执行，支持后台运行和超时控制                                                                             |
| `AskUserQuestion` | 向用户提问，支持单选/多选选项                                                                                    |
| `WebFetch`        | 网页内容抓取与 AI 摘要                                                                                           |
| `Artifact`        | 发布本地 `.html`/`.md` 为可分享网页，或读取已发布页面的原文/摘要（已登录时默认注册，可用 `enableArtifact` 覆盖） |
| `Exec`            | 在沙箱脚本里编排按需加载的工具调用（默认注册，可被 `enableExec: false` 关闭；注册后取代池内工具的逐条扁平声明）  |

### 任务管理

| 工具         | 说明                                         |
| ------------ | -------------------------------------------- |
| `TaskCreate` | 创建任务（subject、description、activeForm） |
| `TaskGet`    | 获取任务详情                                 |
| `TaskUpdate` | 更新任务状态和属性                           |
| `TaskList`   | 列出所有任务                                 |
| `TaskStop`   | 中止后台任务                                 |

### 定时任务

| 工具         | 说明                               |
| ------------ | ---------------------------------- |
| `CronCreate` | 创建定时任务（5 字段 cron 表达式） |
| `CronDelete` | 删除定时任务                       |
| `CronList`   | 列出所有定时任务                   |

### 工作区与流程

| 工具            | 说明                         |
| --------------- | ---------------------------- |
| `EnterWorktree` | 创建 Git worktree 隔离工作区 |
| `ExitWorktree`  | 退出 worktree（keep/remove） |
| `EnterPlanMode` | 进入计划模式                 |
| `ExitPlanMode`  | 退出计划模式                 |
| `Skill`         | 调用 Skill 技能              |
| `Agent`         | 创建子代理                   |
| `Workflow`      | 运行工作流脚本               |

## 工具详情 {#tool-details}

### Bash — 终端命令执行 {#tool-bash}

| 参数                | 类型    | 说明               |
| ------------------- | ------- | ------------------ |
| `command`           | string  | 必需，要执行的命令 |
| `timeout`           | number  | 超时时间（秒）     |
| `description`       | string  | 命令描述           |
| `run_in_background` | boolean | 是否后台执行       |

执行后显示 `shortResult`（输出最后 3 行摘要）。后台执行时返回任务 ID，可通过任务通知查看结果。

### Read — 读取文件 {#tool-read}

| 参数        | 类型   | 说明                      |
| ----------- | ------ | ------------------------- |
| `file_path` | string | 必需，文件路径            |
| `offset`    | number | 起始行号（默认 1）        |
| `limit`     | number | 最大读取行数（默认 2000） |

支持图片读取（PNG/JPEG/GIF/WebP），自动检测二进制文档（PDF/DOCX 等返回错误提示）。对未变更的文件返回 "File unchanged" 避免重复内容。

### Edit — 精确字符串替换 {#tool-edit}

| 参数          | 类型    | 说明                   |
| ------------- | ------- | ---------------------- |
| `file_path`   | string  | 必需，文件路径         |
| `old_string`  | string  | 必需，要替换的原文     |
| `new_string`  | string  | 必需，替换后的新文     |
| `replace_all` | boolean | 是否批量替换所有匹配项 |

非 `replace_all` 时若 `old_string` 在文件中出现多次则报错，提示提供更多上下文。

### Write — 写入文件 {#tool-write}

| 参数        | 类型   | 说明           |
| ----------- | ------ | -------------- |
| `file_path` | string | 必需，文件路径 |
| `content`   | string | 必需，写入内容 |

写入已存在文件前必须先 Read 确认当前内容；自动创建不存在的父目录。

### Glob — 文件名模式匹配 {#tool-glob}

| 参数      | 类型   | 说明                            |
| --------- | ------ | ------------------------------- |
| `pattern` | string | 必需，glob 模式（如 `**/*.ts`） |
| `path`    | string | 搜索根目录                      |
| `limit`   | number | 最大返回数量（默认 100）        |

### Grep — 文本内容搜索 {#tool-grep}

| 参数          | 类型    | 说明                                     |
| ------------- | ------- | ---------------------------------------- |
| `pattern`     | string  | 必需，正则表达式                         |
| `path`        | string  | 搜索目录                                 |
| `glob`        | string  | 文件过滤模式（如 `*.ts`）                |
| `type`        | string  | 文件类型（如 `ts`、`py`）                |
| `output_mode` | string  | `content`、`files_with_matches`、`count` |
| `-A/-B/-C`    | number  | 匹配后/前/前后上下文行数                 |
| `-i`          | boolean | 大小写无关搜索                           |
| `head_limit`  | number  | 限制输出行数                             |
| `multiline`   | boolean | 多行匹配模式                             |

### LSP — 代码智能 {#tool-lsp}

支持操作：`goToDefinition`、`findReferences`、`hover`、`documentSymbol`、`workspaceSymbol`、`goToImplementation`、`prepareCallHierarchy`、`incomingCalls`、`outgoingCalls`。

### AskUserQuestion — 交互式提问 {#tool-askuser}

| 参数                      | 类型    | 说明                                                    |
| ------------------------- | ------- | ------------------------------------------------------- |
| `questions`               | array   | 必需，问题列表                                          |
| `questions[].question`    | string  | 问题内容                                                |
| `questions[].header`      | string  | 简短标签（最多 12 字符）                                |
| `questions[].options`     | array   | 选项列表（2-4 个），每项含 `label` 和可选 `description` |
| `questions[].multiSelect` | boolean | 是否允许多选                                            |

### WebFetch — 网页内容抓取 {#tool-webfetch}

| 参数     | 类型   | 说明                       |
| -------- | ------ | -------------------------- |
| `url`    | string | 必需，要抓取的 URL         |
| `prompt` | string | 必需，对抓取内容的处理指令 |

内置 15 分钟 LRU 缓存（最大 50MB），自动将 HTTP 升级到 HTTPS，HTML 自动转 Markdown，使用快速模型处理摘要。内容上限 100K 字符。GitHub URL 提示使用 `gh` CLI。

**Artifact URL 拦截**：URL 形如 `{host}/code/artifact/{slug}` 时，WebFetch 走专用读取通道（元数据 + 正文均经登录鉴权），而非抓取公开页面；读取成功时结果附带 `artifactRead: { slug, ver }` 元数据，大内容落盘到临时文件并返回文件路径与预览。

### EnterWorktree / ExitWorktree — Git Worktree 隔离 {#tool-worktree}

**EnterWorktree**：在 `.wave/worktrees/` 下创建独立分支工作区。要求当前在 git 仓库且不在已有 worktree 中。

| 参数   | 类型   | 说明                            |
| ------ | ------ | ------------------------------- |
| `name` | string | worktree 名称（可选，自动生成） |

**ExitWorktree**：

| 参数              | 类型    | 说明                            |
| ----------------- | ------- | ------------------------------- |
| `keep`            | boolean | 是否保留 worktree（默认 false） |
| `discard_changes` | boolean | 是否丢弃未提交更改              |

### CronCreate / CronDelete / CronList — 定时任务 {#tool-cron}

**CronCreate**：

| 参数        | 类型    | 说明                                 |
| ----------- | ------- | ------------------------------------ |
| `cron`      | string  | 必需，5 字段 cron 表达式（本地时区） |
| `prompt`    | string  | 必需，要执行的内容                   |
| `recurring` | boolean | 是否循环（默认 true）                |

**CronDelete**：`id` — 任务 ID。**CronList**：无参数。

限制：最多 50 个任务，循环任务 7 天自动过期。

### TaskCreate / TaskGet / TaskUpdate / TaskList — 任务管理 {#tool-task}

**TaskCreate**：

| 参数          | 类型   | 说明                                  |
| ------------- | ------ | ------------------------------------- |
| `subject`     | string | 必需，任务主题                        |
| `description` | string | 任务描述                              |
| `activeForm`  | string | 进行中的动词形式（如 "正在编写测试"） |

**TaskUpdate**：`id`（必需）、`subject`、`description`、`status`（`pending` -> `in_progress` -> `completed` -> `deleted`）、`blocks`/`blockedBy`。

**TaskList**：无参数，返回所有任务摘要。**TaskGet**：`id` — 获取单个任务详情。

## 自定义工具 (ToolPlugin) {#custom-tools}

通过 `customTools` 选项注册自定义工具，与内置工具并行可用：

```typescript
import { Agent, buildTool } from "wave-agent-sdk";

const myTool = buildTool({
  name: "MyTool",
  description: "我的自定义工具",
  parameters: {
    query: { type: "string", description: "搜索查询" },
  },
  execute: async ({ query }, context) => {
    return { content: `结果: ${query}` };
  },
});

const agent = await Agent.create({
  customTools: [myTool],
  // ...
});
```

`ToolPlugin` 接口：

```typescript
interface ToolPlugin {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: any, context: ToolContext) => Promise<ToolResult>;
}
```

## 权限管理 {#permissions}

Agent 支持细粒度的工具权限控制：

**权限模式 (PermissionMode)**：

| 模式          | 说明                   |
| ------------- | ---------------------- |
| `default`     | 危险操作需用户确认     |
| `plan`        | 计划模式，限制写入操作 |
| `acceptEdits` | 自动接受文件编辑       |

**权限 API**：

```typescript
// 获取/设置权限模式
agent.getPermissionMode();
agent.setPermissionMode("acceptEdits");

// 检查工具权限
await agent.checkPermission("Bash", { command: "rm -rf /tmp/test" });

// 添加权限规则
await agent.addPermissionRule("Bash(npm *)");

// 获取可用工具列表
agent.getAvailableToolNames();
```

**创建时配置**：

```typescript
const agent = await Agent.create({
  permissionMode: "default",
  allowedTools: ["Read", "Glob", "Grep"],
  disallowedTools: ["Bash(rm *)"],
  canUseTool: async (toolName, params) => {
    // 自定义权限判断逻辑
    return { allowed: true };
  },
});
```

**默认自动放行的只读命令**：`default` 模式下，只读 git 命令（`git status` / `git diff` / `git log` / `git show` / `git branch` 及变体 / `git tag` / `git remote` / `git ls-files` / `git rev-parse` / `git config --list` / `git cat-file` / `git count-objects`）默认直接执行、不触发确认；带全局作用域参数（如 `git -C <path> status`）时先剥离前缀再匹配，同样自动放行。原始命令优先匹配，路径级 deny 规则（如 `Bash(git -C /secret status)`）保持优先。写操作（`git push` / `git commit` / `git branch -D` 等）不受影响，仍按正常权限流程确认。

## 工具名常量 {#tool-name-constants}

SDK 导出所有工具名常量，避免硬编码：

```typescript
import {
  BASH_TOOL_NAME, // "Bash"
  READ_TOOL_NAME, // "Read"
  WRITE_TOOL_NAME, // "Write"
  EDIT_TOOL_NAME, // "Edit"
  GLOB_TOOL_NAME, // "Glob"
  GREP_TOOL_NAME, // "Grep"
  LSP_TOOL_NAME, // "LSP"
  WEB_FETCH_TOOL_NAME, // "WebFetch"
  ASK_USER_QUESTION_TOOL_NAME, // "AskUserQuestion"
  TASK_CREATE_TOOL_NAME, // "TaskCreate"
  TASK_GET_TOOL_NAME, // "TaskGet"
  TASK_UPDATE_TOOL_NAME, // "TaskUpdate"
  TASK_LIST_TOOL_NAME, // "TaskList"
  TASK_STOP_TOOL_NAME, // "TaskStop"
  CRON_CREATE_TOOL_NAME, // "CronCreate"
  CRON_DELETE_TOOL_NAME, // "CronDelete"
  CRON_LIST_TOOL_NAME, // "CronList"
  ENTER_WORKTREE_TOOL_NAME, // "EnterWorktree"
  EXIT_WORKTREE_TOOL_NAME, // "ExitWorktree"
  ENTER_PLAN_MODE_TOOL_NAME, // "EnterPlanMode"
  EXIT_PLAN_MODE_TOOL_NAME, // "ExitPlanMode"
  SKILL_TOOL_NAME, // "Skill"
  AGENT_TOOL_NAME, // "Agent"
  WORKFLOW_TOOL_NAME, // "Workflow"
} from "wave-agent-sdk";
```
