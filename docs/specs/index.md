---
aside: false
---

<script setup>
import { data } from './specs.data'
import { withBase } from 'vitepress'

const specHref = (p) => withBase(`/specs/${p.replace(/\.md$/, '.html')}`)
</script>

# 功能清单

本清单汇总全部功能规格说明，作为功能设计和实现的唯一真实来源。

## 统计

<table>
<thead><tr><th>指标</th><th>数量</th></tr></thead>
<tbody><tr v-for="row in data.stats" :key="row.label"><td>{{ row.label }}</td><td>{{ row.value }}</td></tr></tbody>
</table>

## 清单

<table>
<thead><tr><th>分组</th><th>功能</th><th>描述</th><th style="white-space: nowrap">用户故事</th><th style="white-space: nowrap">验收场景</th></tr></thead>
<tbody>
<template v-for="group in data.groups" :key="group.dir">
<tr v-for="(spec, index) in group.specs" :key="spec.path"><td v-if="index === 0" :rowspan="group.specs.length" style="vertical-align: top">{{ group.text }}</td><td><a :href="specHref(spec.path)">{{ spec.name }}</a></td><td>{{ spec.description }}</td><td>{{ spec.usCount }}</td><td>{{ spec.acCount }}</td></tr>
</template>
</tbody>
</table>
