# Agent SDK

核心 Node.js SDK，负责 AI 模型集成、工具系统、记忆管理与会话持久化。

## 安装

```bash
npm install wave-agent-sdk
```

## 核心能力

- **AI 模型集成** — 支持 OpenAI 兼容格式，可配置多模型（主模型 + 快速模型）
- **工具系统** — 内置 Bash、Read、Write、Edit、Glob、Grep、LSP 等工具，支持自定义工具注册
- **记忆管理** — AGENTS.md 项目记忆 + 自动记忆系统 + 记忆规则
- **会话持久化** — JSONL 格式会话存储，支持恢复与回滚
- **子代理系统** — 支持 Bash、Explore、Plan 等专用子代理
- **Skill 技能系统** — 可扩展的斜杠命令与技能插件
- **MCP 协议** — Model Context Protocol 集成
- **插件系统** — 官方插件市场 + 自定义插件支持
- **OpenTelemetry** — 内置遥测支持

## 基本用法

```typescript
import { Agent } from 'wave-agent-sdk';

const agent = await Agent.create({
  model: 'gpt-4',
  apiKey: process.env.WAVE_API_KEY,
  baseURL: 'https://api.example.com/v1',
  callbacks: {
    onAssistantContentUpdated: ({ chunk }) => {
      process.stdout.write(chunk);
    },
  },
});

await agent.sendMessage('帮我写一个排序算法');
```

## 开发

```bash
# 构建
pnpm -F wave-agent-sdk build

# 运行测试
pnpm -F wave-agent-sdk test

# 类型检查
pnpm -F wave-agent-sdk run type-check
```
