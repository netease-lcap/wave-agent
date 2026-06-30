# Wave Code CLI

基于 React Ink 构建的 CLI 终端界面，提供交互式 AI 编程助手体验。

## 安装

```bash
npm install wave-code -g
```

## 使用

```bash
# 启动交互式会话（在当前目录下）
wave

# 单次提问模式
wave -p "解释这个项目的架构"

# 在 git worktree 中隔离工作
wave -w my-feature
```

## 核心功能

- **交互式聊天** — 终端内的实时对话界面，支持流式输出
- **工具调用** — AI 自动调用 Bash、文件读写、搜索等工具完成任务
- **会话管理** — 自动保存会话，支持恢复与回滚
- **记忆系统** — 项目级 AGENTS.md + 自动记忆，跨会话保持上下文
- **Slash 命令** — `/login`（SSO 登录）、`/compact`、`/clear`、`/model`、`/goal` 等内置命令
- **权限模式** — 默认模式、计划模式、自动接受模式
- **子代理** — 自动分派子代理处理复杂任务
- **插件扩展** — 通过插件系统扩展 Skill 和命令

## 开发

```bash
# 开发模式运行
pnpm wave

# 构建
pnpm -F wave-code build

# 运行测试
pnpm -F wave-code test
```
