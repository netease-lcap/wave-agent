---
title: 自定义工作流：多 Agent 编排
description: 用 Workflow 脚本编排多个 Agent，把重复流程固化成一条命令
---

# 自定义工作流：多 Agent 编排

一件事需要很多份互不相同的看法时——几十个文件逐个分析、一个仓库分区域扫、一页页写文档——一个对话轮次撑不住，要把活拆给多个子代理。插件市场里有两个插件正好把这件事的两种做法各演示了一遍：**deep-wiki** 把编排写进提示词（斜杠命令或技能，主 agent 按步骤叫人），**security-audit** 把编排写成脚本（脚本按固定流程扇出）。

## 方式一：提示词里编排，子代理只负责一个角色（deep-wiki） {#custom-workflow-prompt}

适合一次性、交互式的活：用户发起一次，跑完看结果。

```
deep-wiki/
├── .wave-plugin/plugin.json      # 清单：名字、描述、版本
├── agents/wiki-researcher.md     # 三个子代理，各自一个身份
├── agents/wiki-architect.md
├── agents/wiki-writer.md
└── commands/generate.md          # 编排：谁先谁后、传什么
```

`agents/*.md` 是声明式的：frontmatter 只写 `name` 与 `description`，正文是这个人设的职责与硬要求（引用格式、图表数量、验证清单）。子代理按 `<插件名>:<子代理名>` 点名。

`commands/generate.md` 才是编排，它是一份写给主 agent 的步骤表：

1. 先派 `wiki-researcher` 做仓库研究，等它出结论；
2. 把研究结论交给 `wiki-architect`，出目录与入职指南；
3. 目录里的每一页各派一个 `wiki-writer`，多个写手**放在同一批发**，并行推进；
4. 后处理与打包（转义泛型、修 Mermaid、搭 VitePress）不派代理——这些是确定性动作，主 agent 直接做。

两条要点：**每个子代理只拿一个角色**，输入输出写成契约（第一步就把 `(文件路径:行号)` 引用格式定好，逐层传下去）；**确定性动作留在编排器里**，不必为「转义尖括号」再开一个代理。

编排的载体不一定是斜杠命令：同一套步骤搬进 `skills/<名字>/SKILL.md`，用户就不必记住命令名——技能按 `description` 自动匹配，「给这个仓库生成一份带架构图的 Wiki」这类说法直接进流程，还能在自己的正文里按需引 `jobs/xxx.md` 这样的子步骤文件分档。

## 方式二：脚本里编排，子代理只做判断 {#custom-workflow-script}

适合批量、多阶段、要能复现和续跑的活：几十上百个文件查同一类问题，而且每条结论都要被另一个代理独立复核一遍。

骨架就这么长——先要一份清单，再一项两项地过：

```js
export const meta = {
  name: "audit-routes",
  description: "逐个审计 src/routes/ 下的路由是否缺少鉴权，并对抗复核每条发现",
};

const found = await agent("列出 src/routes/ 下所有 .ts 文件。", {
  schema: {
    type: "object",
    required: ["files"],
    properties: { files: { type: "array", items: { type: "string" } } },
  },
});

const audits = await pipeline(
  found.files,
  (file) => agent(`审计 ${file} 是否缺少鉴权，给出文件与行号。`),
  (finding) =>
    agent(`试着推翻这条发现，拿不到 file:line 证据就判它不成立：\n${finding}`),
);

return audits.filter(Boolean);
```

- `agent()` 派一个子代理；`pipeline()` 把两个步骤接到一批条目上，每个条目走完第一步才进第二步，条目之间互不等待。
- `schema` 只加在要机器接着用的那一步：清单变成结构化数组，后面才能逐项派活；正文结论保持散文，复核者读得动。
- 第二步是**唱反调**：谁写的谁审容易放过自己，所以复核交给另一个代理；`filter(Boolean)` 去掉被跳过的条目（`agent()` 只在你跳过它时返回 `null`）。

脚本只是编排：它派活、算数，不读文件也不跑命令，产物由子代理自己写。扇出多少、怎么分组都在脚本里，所以同一份输入跑两次，代理的数量与分组一致；中断后能从 runId 续跑，跑多少 token 也能在脚本里卡。

security-audit 就是这个骨架的完整版：前门是一份技能（认口语说法、先量后问），扇出写在 `workflows/scan.js`——在「审计 → 复核」前面加了威胁建模，把仓库切成区域并行，high 档把复核升级成三视角投票，外加自己的报告格式。插件里的工作流按 `<插件名>:<脚本名>` 调用，即 `security-audit:scan`，`/workflows` 里能看到它跑到哪个阶段。

## 选哪种，以及怎么开始 {#custom-workflow-start}

- 单次、要看过程、步骤之间需要人判断 → 写在提示词里（斜杠命令或技能），子代理各管一段（deep-wiki）。
- 批量、多阶段、要可复现 / 断点续跑 / 卡预算 → 写成脚本（security-audit）。
