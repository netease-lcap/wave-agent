---
title: Agent SDK
description: Agent SDK 概览：安装、核心能力、最小可用示例，以及按主题分页的目录
---

# Agent SDK

核心 Node.js SDK，负责 AI 模型集成、工具系统、记忆管理与会话持久化。

## 按主题查看 {#topics}

| 主题                                      | 内容                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Agent 生命周期](/sdk/agent-lifecycle)    | 创建 Agent、构造选项、属性与方法、`destroy()` 的终态语义                                      |
| [消息处理与回调](/sdk/messaging)          | 发送消息与消息队列、消息类型、流式输出、各回调面                                              |
| [工具系统](/sdk/tools)                    | 内置工具清单与参数、自定义 ToolPlugin、权限规则、工具名常量                                   |
| [Artifact 工具](/sdk/tool-artifact)       | 发布私有网页、读取/列举/资源管理/页内评论                                                     |
| [Exec 工具](/sdk/tool-exec)               | 把延迟工具池收敛成可编排的沙箱脚本工具                                                        |
| [会话管理](/sdk/sessions)                 | 创建、恢复、历史操作与 jsonl 文件存储                                                         |
| [插件系统、MCP 与插件市场](/sdk/plugins)  | 插件配置与管理、官方市场、MCP 集成                                                            |
| [记忆系统](/sdk/memory)                   | AGENTS.md 分层记忆、自动记忆提取、MEMORY.md 容量治理                                          |
| [后台任务与工作流](/sdk/background-tasks) | 后台任务、工作流、前台任务、状态回调与完成通知                                                |
| [其他能力](/sdk/other-features)           | 斜杠命令、Bash 模式、SSO、提示历史、Git 工具、文件搜索、计划模式、Worktree                    |
| [内置 Skills](/sdk/builtin-skills)        | settings / init / loop / simplify / code-review / artifact / wave-daemon / workflow-authoring |
| [内置 Subagents](/sdk/builtin-subagents)  | Explore、Plan、General-Purpose、Vision                                                        |
| [Settings Skill](/sdk/settings)           | 以自然语言管理 settings.json 的全部配置面                                                     |
| [OpenTelemetry 遥测](/sdk/telemetry)      | 上报出口、导出器、指标、归属属性、事件日志、PII 与可靠性                                      |

本页只讲安装与最小可用示例；其余内容按上表分页。

## 快速开始 {#quick-start}

### 安装 {#install}

```bash
npm install wave-agent-sdk
```

### 核心能力 {#capabilities}

- **AI 模型集成** — 支持 OpenAI 兼容格式，可配置多模型（主模型 + 快速模型）
- **工具系统** — 内置 Bash、Read、Write、Edit、Glob、Grep、LSP 等工具，支持自定义工具注册
- **记忆管理** — AGENTS.md 项目记忆 + 自动记忆系统 + 记忆规则
- **会话持久化** — JSONL 格式会话存储，支持恢复与回滚
- **子代理系统** — 支持 Explore、Plan、general-purpose 等专用子代理
- **Skill 技能系统** — 可扩展的斜杠命令与技能插件
- **MCP 协议** — Model Context Protocol 集成
- **插件系统** — 官方插件市场 + 自定义插件支持
- **OpenTelemetry** — 内置遥测支持

### 基本用法 {#basic-usage}

```typescript
import { Agent } from "wave-agent-sdk";

// 创建 Agent
const agent = await Agent.create({
  model: "gpt-4",
  apiKey: process.env.WAVE_API_KEY,
  baseURL: "https://api.example.com/v1",
  callbacks: {
    onAssistantContentUpdated: ({ chunk }) => {
      process.stdout.write(chunk);
    },
  },
});

// 发送消息
await agent.sendMessage("帮我写一个排序算法");

// 销毁 Agent（清理资源）
await agent.destroy();
```
