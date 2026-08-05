<script setup>
import { data } from './specs.data'
import { withBase } from 'vitepress'

const specHref = (p) => withBase(`/specs/${p.replace(/\.md$/, '.html')}`)
</script>

# 功能规格说明

本目录包含功能规格说明文件，作为功能设计和实现的唯一真实来源。

每个规格是一个独立的 markdown 文件（按主题分组存放于子目录），包含用户故事与验收场景。

## 为什么没有 Plan？

1. **内置能力足够强大。** Plan 模式结合权限系统控制读写范围，Task 系统对多 Agent 协作友好且自带系统提示防止上下文丢失。
2. **无法仅靠思考设计出完美方案。** 边界情况、API 怪癖、集成问题只有在实现中才会暴露，静态 plan 注定频繁改动、迅速过时，不如交给 Agent 用完即弃。

## 统计

<table>
<thead><tr><th>指标</th><th>数量</th></tr></thead>
<tbody><tr v-for="row in data.stats" :key="row.label"><td>{{ row.label }}</td><td>{{ row.value }}</td></tr></tbody>
</table>

## 规格列表

<template v-for="group in data.groups" :key="group.dir">
<h3>{{ group.text }}</h3>
<table>
<thead><tr><th>功能</th><th>描述</th><th>用户故事</th><th>验收场景</th><th>链接</th></tr></thead>
<tbody><tr v-for="spec in group.specs" :key="spec.path"><td>{{ spec.name }}</td><td>{{ spec.description }}</td><td>{{ spec.usCount }}</td><td>{{ spec.acCount }}</td><td><a :href="specHref(spec.path)">规格</a></td></tr></tbody>
</table>
</template>

## 上下文消息结构总览

发送给 AI 模型的 `messages` 数组按以下顺序组装：

| 位置 | 角色                    | 内容                                                                                                 | 缓存标记   | 持久化                 | 用户可见 | 说明                                       |
| ---- | ----------------------- | ---------------------------------------------------------------------------------------------------- | ---------- | ---------------------- | -------- | ------------------------------------------ |
| [0]  | system                  | 基础系统提示词 + 任务执行准则 + 行动准则 + 工具策略 + 输出效率 + 语气风格                            | 有         | 不持久化               | 否       | 子代理替换基础系统提示词，其余相同         |
|      |                         | 语言指令 + 环境信息（主代理 `# Environment` 列表 / 子代理 Notes + `<env>` 块）+ 自动记忆 (MEMORY.md) | 无         | 不持久化               | 否       |                                            |
| [1]  | user (meta)             | `<system-reminder>`: 项目 AGENTS.md + 用户 AGENTS.md + 无条件规则                                    | 无         | 不持久化，每轮插入头部 | 否       | 唯一每轮注入                               |
| 历史 | user / assistant / tool | 文本块 / 图片块 / 工具块 / 后台任务通知块 / 推理块                                                   | 最后一条有 | 持久化到 session JSONL | 是       |                                            |
|      | user (isMeta)           | 计划模式提醒 / 条件规则 / 任务提醒 / SessionStart Hook 上下文 / 后台任务通知 / Token 限制续写        | 同上       | 同上                   | 否       | 触发时插入当时的结尾，各类型有独立触发条件 |

**专用调用**：

- **Fork 复用主对话上下文**（复用主系统提示词、工具、模型与生成参数，指令作为末尾 user 消息追加，命中 prompt cache；无独立系统提示词）：上下文压缩（`runCompactFork` → `runForkLoop`）、自动记忆提取（`runAutoMemoryFork` → `runForkLoop`）、BTW 旁路问题（`runBtwFork`，同构的内联单轮调用）。
- **独立调用**（自带独立系统提示词，不经过主系统提示词组装）：网页内容提取（`processWebContent`，内置 `WEB_CONTENT_SYSTEM_PROMPT`，独立请求，不走会话历史）。
- **常规子代理机制**：Workflow 结构化输出——spawn 常规子代理（general-purpose），schema 指令追加到 prompt 末尾并强制 StructuredOutput `tool_choice`，非独立调用路径。
