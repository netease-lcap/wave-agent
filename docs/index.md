---
layout: home
title: Wave Agent
---

# Wave Agent

AI 辅助编程工具链，提供 SDK、CLI 终端界面与 VS Code 扩展三种使用方式。

[VS Code 扩展](/vsce) · [CLI](/cli) · [SDK](/sdk)

## 项目结构

| 包 | 说明 |
| --- | --- |
| **agent-sdk** | 核心 SDK，处理 AI 模型集成、工具系统与记忆管理 |
| **code** | CLI 终端界面，基于 React Ink 构建的交互式命令行 |
| **vsce** | VS Code 扩展，带 React Webview 聊天 UI |

## 快速开始

### CLI 终端

```bash
# 全局安装
npm install wave-code -g

# 启动
wave

# 在对话中输入 /login，通过浏览器完成 SSO 登录
/login
```

### VS Code 扩展

从 [Releases](https://github.com/netease-lcap/wave-agent/releases) 下载 `.vsix` 文件安装，在对话中输入 `/login` 完成 SSO 登录。

### SDK 集成

```bash
npm install wave-agent-sdk
```

```typescript
import { Agent } from 'wave-agent-sdk';

const agent = await Agent.create({
  model: 'gpt-4',
  apiKey: 'your-key',
  baseURL: 'https://api.example.com/v1',
  callbacks: {
    onAssistantContentUpdated: ({ chunk }) => {
      process.stdout.write(chunk);
    },
  },
});

await agent.sendMessage('Hello!');
```

