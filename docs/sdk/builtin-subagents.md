---
title: 内置 Subagents
description: 内置 Subagents：Explore、Plan、General-Purpose、Vision 与 Wave Guide
---

# 内置 Subagents {#builtin-subagents}

## Explore — 代码库探索 {#subagent-explore}

只读的代码定位代理，用于按模式找文件、按符号/关键词检索，或回答「X 定义在哪 / 谁引用了 Y」。**不用于** code review、设计文档审计、跨文件一致性检查或开放式分析——它只读片段，不看整个文件，会漏掉读取窗口之外的内容。支持三种检索广度：`quick`、`medium`、`very thorough`。

- **工具**: 黑名单模式（除 `Agent`、`Artifact`、`ExitPlanMode`、`Edit`、`Write` 之外全部可用，含 WebFetch、Skill、LSP 等）
- **模型**: 继承主代理模型（`model: inherit`，对齐 Claude Code）
- **记忆**: 跳过项目 `AGENTS.md`（及 `CLAUDE.md` 回退）、用户记忆与 `.wave/rules` 无条件规则（`omitAgentsMd: true`）
- **模式**: 只读，禁止任何文件修改操作

## Plan — 软件架构师 {#subagent-plan}

设计实现方案的软件架构师代理，返回分步策略、识别关键文件、考虑架构权衡。

- **工具**: 与 Explore 相同的黑名单（只读 + 其余全部可用）
- **模型**: 继承主代理模型
- **记忆**: 同样跳过项目 `AGENTS.md` 与 `.wave/rules`（`omitAgentsMd: true`）
- **模式**: 只读，禁止任何文件修改操作

## General-Purpose 代理 {#subagent-general-purpose}

用于研究复杂问题、搜索代码和执行多步骤任务的通用代理。

- **模型**: 继承主代理模型

```typescript
// 获取子代理实例
const subagent = agent.getSubagentInstance("explore");
```

## Vision — 图像识别 {#subagent-vision}

图像识别专家，运行在 `WAVE_VISION_MODEL` 指定的视觉模型上。当主模型不支持图像识别（如 DeepSeek 等快速非视觉模型）但用户分享了图片时，主模型可委托该子代理读取图片并返回详细的文字描述。

- **工具**: `[Read]`
- **模型**: `WAVE_VISION_MODEL` 环境变量指定的视觉模型（frontmatter `model: visionModel` 解析）

**启用方式**：设置 `WAVE_VISION_MODEL` 环境变量（如 `qwen-vl-max`）**且**主模型显式声明不支持图像识别（`models[<主模型>].capabilities: { "vision": false }`）时，内置 `vision` 子代理才可用；两个条件缺一个都不注册。判定沿用 `capabilities.vision` 的 opt-out 语义 —— 主模型没声明该能力位时按「能看图」处理，因此内置 `vision` 不会出现（图片直接以图像块发给主模型）。这道门在每轮请求读取子代理列表时判定，会话中换模型会立即跟随；列表里没有的也不能按名字点名调用。与 `fastModel` 机制对称，详见 [环境变量](./settings#settings-env)。

## Wave Guide — 文档问答 {#subagent-wave-guide}

回答「Wave 怎么用」类问题的文档代理：不凭记忆作答，而是读官方文档站后回答，并给出所用页面的链接。主代理遇到「怎么配置 X」「有没有 Y 功能」「某个开关在哪」时应委托它，而不是凭上下文印象作答。

- **工具**: 黑名单模式，额外禁掉 `Bash`（只读文档查询，不需要执行命令）
- **模型**: 快速模型（`model: fastModel`）
- **记忆**: 跳过项目 `AGENTS.md` 与 `.wave/rules`（`omitAgentsMd: true`）
- **文档入口**: 提示词里的 `${WAVE_DOCS_URL}` 在加载时替换成 `<serverUrl>/docs/`——取 `WAVE_SERVER_URL`（未设置则用默认服务端地址），因此私有化/测试部署的代理读的是自己那套文档。行为约定：
  1. 先取 `llms.txt` 目录（每页一行 + 摘要），不猜页面路径；
  2. 按目录取 1–3 页 `.md` 正文作答，不整站抓取，也不取 `llms-full.txt`（整站合集，几百 KB）；
  3. 抓不到就在答复开头明说「文档站不可达」并给出入口链接，只回答本地文件能验证的部分，不编造设置项名或菜单路径；
  4. 工作目录本身是 Wave 仓库时，允许用 `Grep`/`Glob`/`Read` 读源码回答实现细节（源码说「怎么实现」，文档站说「怎么用」）。
