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
