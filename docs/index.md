---
layout: home
title: CodeChat
---

# CodeChat AI辅助编程工具

AI 辅助编程工具链，提供 SDK、CLI 终端界面与 VS Code 扩展三种使用方式。

[企业管控台](/guide) · [VS Code 扩展](/vsce) · [CLI](/cli) · [SDK](/sdk)

## 快速开始

### VS Code 扩展

下载 `.vsix` 文件安装，在对话中输入 `/login` 完成 SSO 登录。

### CLI 终端

```bash
# 全局安装
npm install wave-code -g

# 启动
wave

# 在对话中输入 /login，通过浏览器完成 SSO 登录
/login
```

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

