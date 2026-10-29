---
title: 内置 Subagents
description: 内置 Subagents：Explore、Plan、General-Purpose 与 Vision
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
