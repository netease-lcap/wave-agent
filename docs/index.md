---
title: 产品概览
---

# CodeWave IDE AI辅助编程工具

CodeWave IDE 是面向开发者团队的 AI 智能编程系统。无论你习惯桌面客户端、IDE 插件、命令行，还是想把 AI 能力嵌入自有产品，都能以同一套工作流让 AI 深度参与编码——从代码生成、工程理解到团队治理，覆盖研发全生命周期。

[企业管控台](/guide) · [VS Code 扩展 / JetBrains 插件](/vsce) · [桌面版](/desktop) · [CLI](/cli) · [SDK](/sdk)

## 产品矩阵：五种形态

CodeWave IDE提供多种产品形态，满足从个人开发者到企业团队的不同使用方式。所有形态共享同一套会话、产物与团队数据，切换形态不打断工作流。

- **桌面端**：macOS / Windows 全覆盖。并排多会话，Localhost原型预览与元素标注，提升开发效率。
- **VSCode插件**：在编辑器内直接发起会话，选中代码一键解释、重构与生成，产物落地为真实文件。
- **JetBrains 插件**：IntelliJ IDEA、WebStorm 等 JetBrains IDE。
- **CLI**：提供两种运行模式：启动基于 React Ink 的终端 UI，支持实时对话、流式输出和完整的交互体验；非交互式运行，接收输入并一次性输出结果，适用于脚本集成和自动化流水线。
- **SDK**：核心 Node.js SDK，负责 AI 模型集成、工具系统、记忆管理与会话持久化。

## 使用场景

无论是日常功能迭代，还是复杂工程攻坚，CodeWave IDE都能胜任，典型场景包括：

- **从 0 到 1 创建项目**：只要用自然语言描述想要什么，智能体便会拆解需求、生成代码、运行验证并给出结果预览。
- **维护已有代码库**：在项目上下文中精准定位相关文件、理清依赖关系，在既有实现之上进行修改、重构与问题排查。
- **提升编码效率**：跨会话记忆不再重复踩坑和提问；把高频流程固化成指令/技能/钩子一句话即可复用；多会话并行开发，子代理并行分工，一个人相当于一个团队。

## 支持的操作系统

| 操作系统 | 最低版本 / 发行版      | 架构                 | 说明                           |
| -------- | ---------------------- | -------------------- | ------------------------------ |
| macOS    | 12.0 及以上            | Apple Silicon、Intel |                                |
| Windows  | Windows 10、Windows 11 | 64 位（x64）         | 要求nodejs 20+，且安装git bash |

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
