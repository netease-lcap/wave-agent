---
title: 产品概览
---

# CodeWave IDE AI辅助编程工具

CodeWave IDE 是面向开发者团队的 AI 智能编程系统。无论你习惯桌面客户端、插件端、命令行，想用手机远程接管，还是想把 AI 能力嵌入自有产品，都能以同一套工作流让 AI 深度参与编码——从代码生成、工程理解到团队治理，覆盖研发全生命周期。

[企业管控台](/guide) · [VS Code 扩展 / JetBrains 插件](/vsce) · [Web 端](/web) · [桌面版](/desktop) · [CLI](/cli) · [SDK](/sdk)

## 产品矩阵：六种形态

CodeWave IDE提供多种产品形态，满足从个人开发者到企业团队的不同使用方式。所有形态共享同一套会话、产物与团队数据，切换形态不打断工作流。

- **桌面端**：macOS / Windows 全覆盖。并排多会话，Localhost原型预览与元素标注，提升开发效率。
- **VSCode插件**：在编辑器内直接发起会话，选中代码一键解释、重构与生成，产物落地为真实文件。
- **JetBrains 插件**：IntelliJ IDEA、WebStorm 等 JetBrains IDE。
- **CLI**：提供两种运行模式：启动基于 React Ink 的终端 UI，支持实时对话、流式输出和完整的交互体验；非交互式运行，接收输入并一次性输出结果，适用于脚本集成和自动化流水线。
- **SDK**：核心 Node.js SDK，负责 AI 模型集成、工具系统、记忆管理与会话持久化。
- **Web 端**：浏览器直接打开，PC 与手机都能用（手机可安装为 Web App），远程接管电脑上运行的 agent 会话——看进度、批操作、接着对话。

## 使用场景

无论是日常功能迭代，还是复杂工程攻坚，CodeWave IDE都能胜任，典型场景包括：

- **从 0 到 1 创建项目**：只要用自然语言描述想要什么，智能体便会拆解需求、生成代码、运行验证并给出结果预览。
- **维护已有代码库**：在项目上下文中精准定位相关文件、理清依赖关系，在既有实现之上进行修改、重构与问题排查。
- **提升编码效率**：跨会话记忆不再重复踩坑和提问；把高频流程固化成指令/技能/钩子一句话即可复用；多会话并行开发，子代理并行分工，一个人相当于一个团队。

## 产品特色

除了形态齐全，CodeWave IDE 在团队治理、长任务稳定性与上下文成本上做了针对性设计：

<div class="feature-grid">
  <div class="feature-card">
    <div class="feature-card-title">企业级管控</div>
    <p>用量、计费、研发效能度量、监控、配置下发、SSO 登录，一个管控台统一治理团队与成本。</p>
  </div>
  <div class="feature-card">
    <div class="feature-card-title">多智能体与并发</div>
    <p>worktree 手动并发、子代理自动并发、动态工作流编排。一天处理上百个缺陷单，一次扫描重构超大型代码库。</p>
  </div>
  <div class="feature-card">
    <div class="feature-card-title">长任务不丢上下文</div>
    <p>完善的 Task 系统撑住 8 小时以上的连续运行；上下文接近容量上限时自动压缩、只保留关键信息继续推进。任务不丢失，上下文不遗漏。</p>
  </div>
  <div class="feature-card">
    <div class="feature-card-title">工具按需加载</div>
    <p>基于 Code Mode 的工具按需加载，挂上百个 MCP 工具上下文也不会爆炸，响应更快、更省 token。</p>
  </div>
  <div class="feature-card">
    <div class="feature-card-title">内置 SDD</div>
    <p>无需额外安装插件，开箱即用规格驱动开发，需求先落规格再动代码，自动生成详细规格文档，减少返工、提升可维护性。</p>
  </div>
  <div class="feature-card">
    <div class="feature-card-title">随时随地使用</div>
    <p>桌面端、VS Code、JetBrains、CLI、SDK 之外，还支持 Web 与移动端远程控制，换个设备接着跑。</p>
  </div>
</div>

## 与 Claude Code 的对比 {#vs-claude-code}

Claude Code 是 Anthropic 官方的编程智能体，国内团队通常有两种接入方式：**企业版**（claude.ai 团队 / 企业订阅，用 SSO 登录）与**自建网关**（把 `ANTHROPIC_BASE_URL` 指向自建网关，转发国内模型的 Anthropic 兼容接口）。

CodeWave IDE 的能力面与企业版对齐：同样提供组织级配置下发、成员与用量管理、工具按需加载与动态工作流编排，同时不依赖 claude.ai 账号与海外网络。自建网关这条线要另外算：Claude Code 会按 `ANTHROPIC_BASE_URL` 是否首方域名整体降级，关掉的不只是几个功能，而是整条组织管控与按需加载链路。

✅ 具备 · ⚠️ 有前置条件或受限 · ❌ 不具备

| 能力               | CodeWave IDE                                                           | Claude Code 企业版                    | Claude Code + 自建网关                           |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------ |
| **客户端形态**     | ✅ 桌面端 / VS Code / JetBrains / CLI / SDK / Web 端，六种形态共享会话 | ✅ 终端 / 插件端 / 桌面端 / 网页端    | ⚠️ 仅终端 / 插件端，无桌面端与网页端             |
| **网络与登录**     | ✅ 国内网络直连，企业自有 SSO                                          | ⚠️ 需 claude.ai 的网络与账号          | ⚠️ 网络可达，但无企业账号与身份体系              |
| **成员与席位**     | ✅ 管控台邀请成员、配置坐席、分配额度                                  | ✅ 席位与角色管理                     | ❌ 无席位体系，仅网关凭据                        |
| **组织级配置下发** | ✅ 服务端托管配置，含插件市场与启用列表下发                            | ✅ 企业后台下发托管设置               | ❌ 策略取用被判不可用，只能靠本机配置文件        |
| **用量与成本**     | ✅ 管控台用量 / 额度 / 积分 + OTel 导出                                | ✅ 分析看板、贡献度指标、企业分析 API | ❌ 费用只在自己的网关侧，CC 无看板与成员维度统计 |
| **合规与数据**     | ✅ 代码与命令在本机执行，请求走企业网关                                | ✅ 审计日志、合规 API、零数据保留     | ❌ 无                                            |
| **工具按需加载**   | ✅ 默认开启，延迟工具池按需装载                                        | ✅ 默认开启（ToolSearch）             | ❌ 默认关闭，且强开要求网关转发 `tool_reference` |
| **子代理与并发**   | ✅ 子代理、后台任务、worktree 并行                                     | ✅ 具备                               | ✅ 具备                                          |
| **扩展生态**       | ✅ 技能 / 钩子 / MCP / 插件市场全内置                                  | ✅ 均具备，claude.ai 侧同步需登录     | ⚠️ 本地具备，claude.ai 侧同步不可用              |
| **产物分享**       | ✅ Artifacts 一键发布可分享网页                                        | ⚠️ 需 claude.ai 登录，可被管理员关闭  | ❌ 网关凭据不能发布                              |

> **口径说明**：Claude Code 两列以 Anthropic 官方文档为准——[功能可用性](https://docs.claude.com/en/docs/claude-code/feature-availability)、[第三方集成](https://docs.claude.com/en/docs/claude-code/third-party-integrations)、[用量分析](https://docs.claude.com/en/docs/claude-code/analytics)、[零数据保留](https://docs.claude.com/en/docs/claude-code/zero-data-retention)。补充一点：「工具按需加载」官方原文是工具检索在 `ANTHROPIC_BASE_URL` 指向非首方域名时默认关闭，且**要开启需网关自己转发 `tool_reference` 块**——国内模型的 Anthropic 兼容接口只做请求转发，不提供服务端的工具定义展开，实际拿不到。

## 支持的操作系统

| 操作系统 | 最低版本 / 发行版      | 架构                 | 说明                           |
| -------- | ---------------------- | -------------------- | ------------------------------ |
| macOS    | 12.0 及以上            | Apple Silicon、Intel |                                |
| Windows  | Windows 10、Windows 11 | 64 位（x64）         | 要求nodejs 20+，且安装git bash |

## 快速开始

### VS Code 扩展

在 VS Code 扩展市场搜索 **CodeWave IDE**（扩展 ID：`wave-codechat.wave-vscode`）安装。打开聊天面板点击欢迎页的「登录」按钮完成 SSO 登录。

### JetBrains 插件

在 JetBrains 插件市场（IDE「设置 → 插件」）搜索 **CodeWave IDE** 安装。打开聊天面板点击欢迎页的「登录」按钮完成 SSO 登录。

### 桌面端

在管控台「产品下载」页面下载 CodeWave IDE 桌面版安装包（macOS / Windows）并安装。桌面端是独立应用，无需安装 IDE，安装后直接使用。

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
