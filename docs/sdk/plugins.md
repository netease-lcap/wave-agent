---
title: 插件系统、MCP 与插件市场
description: 插件配置与管理、官方插件市场，以及 MCP 服务器集成
---

# 插件系统、MCP 与插件市场

## 插件系统 {#plugin-system}

### 插件配置 {#plugin-config}

通过 `AgentOptions.plugins` 加载本地插件：

```typescript
const agent = await Agent.create({
  plugins: [{ path: "/path/to/my-plugin" }],
});
```

通过 `settings.json` 的 `enabledPlugins` 启用已安装的插件。插件的 skill、hook、MCP 和 LSP 服务器可使用 `${WAVE_PLUGIN_ROOT}` 占位符引用其父插件目录。

**企业托管配置**：服务端下发的托管配置里同样可以带 `marketplaces` 与 `enabledPlugins`，此时插件子系统会消费它们——首次启动即自动安装并启用指定插件，用户无需手动点「安装」。托管层与本地 `settings.json` 按**键**合并，托管层的同名键覆盖本机值（本机写 `false` 也翻不过来），本机独有的键照常保留。因此由托管配置启用的插件在界面上被视为「由组织管理」：卸载入口不可用，CLI 卸载也会被拒绝；管理员把该插件从托管配置里去掉后，它才回到用户可自行安装 / 卸载的普通状态。

### 插件管理 {#plugin-management}

SDK 通过 `PluginCore` 提供完整的插件管理能力：

- 插件安装与卸载
- 插件启用与禁用
- 插件升级（单个插件，或「批量更新插件」批量升级整个市场的插件）
- Skill、Hook、MCP、LSP 资源自动注册

### Marketplace 集成 {#marketplace}

SDK 内置 Marketplace 服务，支持从远程 Git 仓库安装和管理插件。默认市场 `wave-plugins-official` 自动启用；所有已注册市场的清单在打开插件市场界面时自动刷新（只拉取检出内容，不升级已安装插件）。

## MCP 集成 {#mcp-integration}

### 配置方式 {#mcp-config}

支持两种 MCP 服务器连接方式：

**本地进程（stdio）**：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    }
  }
}
```

**远程 HTTP/SSE**：

```json
{
  "mcpServers": {
    "remote-server": {
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

可通过 `AgentOptions.mcpServers` 在创建时注入，或通过 `settings.json` 配置。

### 管理 API {#mcp-api}

```typescript
// 获取所有 MCP 服务器状态
const servers = agent.getMcpServers();
// 返回 McpServerStatus[]

// 连接指定 MCP 服务器
await agent.connectMcpServer("github");

// 断开指定 MCP 服务器
await agent.disconnectMcpServer("github");
```

服务器在 `initialize` 响应里返回的使用说明（`instructions`）会被记录在 `McpServerStatus.instructions` 上，并在服务器变为可用时**播报一次**（作为一条对 UI 隐藏的消息追加进对话历史，按服务器标明来源；多行文本原样保留，单台服务器超过 2048 字节时截断并标明）——适合承载限流、前置条件、整体用法约定这类"不调用也要知道"的信息。已播报过的服务器不重复播报；服务器断开时播报一次"已下线、上述说明不再适用"（已播报原文留在历史里，不回撤，与"历史不改写"一致）；工具被权限规则全部排除的服务器不播报（与工具同源）。见 `docs/specs/ecosystem/mcp.md`。

### 状态回调 {#mcp-callbacks}

```typescript
callbacks: {
  onMcpServersChange: (servers) => {
    // MCP 服务器状态变更时触发
    servers.forEach(s => console.log(s.name, s.status));
  },
}
```

## 官方插件市场 {#plugin-marketplaces}

SDK 内置默认插件市场 `wave-plugins-official`（来源：[netease-lcap/wave-plugins-official](https://github.com/netease-lcap/wave-plugins-official)），自动启用，与其他市场一样在打开插件市场界面时自动刷新清单。该市场提供以下插件：

### document-skills {#plugin-document-skills}

文档处理套件，包含 **docx**（Word）、**xlsx**（Excel）、**pptx**（PowerPoint）和 **pdf** 四个技能组。AI 可以读取、创建和编辑各类办公文档，支持内容提取、格式转换和数据操作。

### typescript-lsp {#plugin-typescript-lsp}

TypeScript/JavaScript 语言服务器，通过 `typescript-language-server --stdio` 提供代码智能支持。包括代码补全、跳转定义、查找引用、符号搜索、类型提示和错误诊断等功能。

### chrome-devtools {#plugin-chrome-devtools}

Chrome DevTools Protocol MCP 服务器，通过 `npx chrome-devtools-mcp` 启动。支持浏览器自动化操作，包括页面导航、元素检查、截图、网络请求监控、控制台执行等。

### code2spec {#plugin-code2spec}

从代码生成规格说明文档的工具集。基于代码库自动创建 requirements、plan、tasks 等技术规格模板，帮助团队建立代码与文档的对应关系。

### code2cwspec {#plugin-code2cwspec}

从现有代码（.NET、Java 等老系统）逆向生成为 CodeWave 格式的规范模板。包含 **4 个子代理**：cw-architect（架构分析）、cw-researcher（代码调研）、cw-validator（规范校验）、cw-writer（文档生成），输出 requirements/plan/tasks 完整规范。

### commit-skills {#plugin-commit-skills}

简化的 Git 工作流技能集，包含 **5 个技能**：commit（提交）、commit-push-mr（提交并推送 MR）、commit-push-pr（提交并推送 PR）、watch-merge-mr（等待合并 MR）、watch-merge-pr（等待合并 PR）。支持从代码审查到合并的全流程自动化。

### deep-wiki {#plugin-deep-wiki}

AI 驱动的 Wiki 生成器，支持 Mermaid 图表、源码引用、入职指南和 llms.txt 生成。包含 **3 个子代理**（wiki-architect、wiki-researcher、wiki-writer）和 **3 个命令**（ask、build、generate）。

### tavily-search {#plugin-tavily-search}

Tavily AI 驱动的搜索引擎 MCP 服务器，通过 `https://mcp.tavily.com/mcp/` 提供网络搜索能力。

### frontend-design {#plugin-frontend-design}

创建独特的、生产级前端界面设计技能。注重美学品质，避免千篇一律的 AI 审美风格。
