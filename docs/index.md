---
layout: home
title: CodeChat
---

# CodeChat AI辅助编程工具

AI 辅助编程工具链，提供 SDK、CLI 终端界面、VS Code 扩展、JetBrains 插件与桌面端五种使用方式。

[企业管控台](/guide) · [VS Code 扩展 / JetBrains 插件](/vsce) · [桌面版](/desktop) · [CLI](/cli) · [SDK](/sdk)

## 快速开始

### VS Code 扩展

在 VS Code 扩展市场搜索 **Wave Code Chat**（扩展 ID：`wave-codechat.wave-vscode`）安装。打开聊天面板点击欢迎页的「登录」按钮完成 SSO 登录。

### JetBrains 插件

在 JetBrains 插件市场（IDE「设置 → 插件」）搜索 **Wave Code Chat** 安装。打开聊天面板点击欢迎页的「登录」按钮完成 SSO 登录。

### 桌面端

在管控台「产品下载」页面下载 Wave 桌面版安装包（macOS / Windows）并安装。桌面端是独立应用，无需安装 IDE，安装后直接使用。

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
import { Agent } from "wave-agent-sdk";

const agent = await Agent.create({
  model: "gpt-4",
  apiKey: "your-key",
  baseURL: "https://api.example.com/v1",
  callbacks: {
    onAssistantContentUpdated: ({ chunk }) => {
      process.stdout.write(chunk);
    },
  },
});

await agent.sendMessage("Hello!");
```
