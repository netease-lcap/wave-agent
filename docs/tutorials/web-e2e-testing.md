---
title: 实现网页自动化测试
description: 用 Playwright 与 CLI 让 agent 自己跑端到端测试并修到通过
---

# 实现网页自动化测试

功能验证与回归测试是保证页面质量的关键。CodeWave IDE 可以让 AI 直接驱动真实浏览器完成"打开页面 → 操作元素 → 校验结果"的自动化测试，并把结论整理成测试报告。

本教程推荐 **Playwright CLI**（`playwright-cli`）：它由 AI 通过 Bash 工具直接调用，无需安装插件或配置 MCP；命令简短、只在需要时抓取页面数据，**不必把工具 schema 与整棵页面无障碍树塞进模型上下文，因此比 MCP 方案更省 token**。

## 安装 Playwright CLI

```bash
npm install -g @playwright/cli@latest   # 需要 Node.js 18+
playwright-cli --help                   # 确认安装成功
```

可选：把它的用法安装成技能，AI 会自动匹配加载（写入项目 `.agents/skills/`，Wave 会识别该目录）：

```bash
playwright-cli install --skills=agents
```

不装技能也可以——直接让 AI 读 `playwright-cli --help` 自己上手。

## 对话驱动自动化测试

直接用自然语言描述测试目标即可。AI 会用 `open` 打开页面、`snapshot` 抓取可交互元素快照（每个元素带 `ref`）、再用 `fill` / `click` / `select` / `press` 操作元素，最后用 `screenshot` / `eval` 校验结果：

> 打开登录页 https://example.com/login，填写账号密码点击登录，检查是否跳转成功并截图，最后把测试结论写成 test-report.md

对应的命令大致如下：

```bash
playwright-cli open https://example.com/login --browser chrome
playwright-cli snapshot          # 拿到页面上各元素的 ref
playwright-cli fill e3 "dev@example.com"
playwright-cli fill e4 "******"
playwright-cli click e5
playwright-cli screenshot        # 校验渲染结果并留证
```

几个容易踩的点：

- **ref 每次都变**：页面一变就重新 `snapshot`，不要复用旧 ref。
- **本地服务优先用 `127.0.0.1`**：部分环境下 `localhost` 会连接异常。
- **`--headed` 可以看着浏览器跑**（调试时好用）；`--device "iphone 15"` / `--mobile` 用于移动端视口校验。
- 快照文件默认落在当前目录的 `.playwright-cli/`。

> Bash 命令首次执行时可能弹出权限确认，勾选「总是允许」后存为信任规则，后续免确认。

## 常用测试指令

- **打开并校验页面**："打开 https://example.com，检查标题和加载状态"
- **表单流程测试**："注册流程：填写表单、提交、校验成功提示"
- **元素交互**："点击首页的『了解更多』按钮，确认跳转到文档页"
- **视觉校验**："对移动端视口截图，检查布局是否有溢出"
- **控制台检查**："检查这个页面控制台有没有报错，把错误列出来"

## 测试报告与回归

AI 会把测试结果整理为结构化的测试报告（用例、步骤、结果、控制台错误、截图），写入项目文件，便于跟踪与回归：

- **首次测试**：让 AI 生成覆盖核心流程的测试步骤并执行
- **回归测试**：修复后让 AI 重跑关键用例："按 test-report.md 里的用例重新跑一遍登录流程"
- **持续集成**：把生成的测试脚本接入 CI，配合定时循环技能（`/loop`）定期巡检页面可用性
