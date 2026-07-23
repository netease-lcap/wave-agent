---
layout: home
title: CodeChat
---

# CodeChat AI辅助编程工具

AI 辅助编程工具链，提供 SDK、CLI 终端界面、VS Code 扩展与 JetBrains 插件四种使用方式。

[企业管控台](/guide) · [VS Code 扩展 / JetBrains 插件](/vsce) · [CLI](/cli) · [SDK](/sdk)

## 快速开始

### VS Code 扩展

从企业控制台「产品下载」页面下载 `.vsix` 文件，在 VS Code 中通过「扩展 → ⋯ → 从 VSIX 安装」安装。打开聊天面板点击欢迎页的「登录」按钮完成 SSO 登录。

### JetBrains 插件

从企业控制台「产品下载」页面下载 JetBrains 插件包，在 IDE（WebStorm、IntelliJ IDEA 等）中通过「设置 → 插件 → ⚙ → 从磁盘安装插件」安装。打开聊天面板点击欢迎页的「登录」按钮完成 SSO 登录。

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

