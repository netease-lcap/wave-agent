import fs from "node:fs";
import path from "node:path";
import { SPECS_DIR, specTitle, collectSpecs } from "./spec-stats.mjs";

const nav = [
  { text: "首页", link: "/" },
  { text: "企业管控台", link: "/guide" },
  { text: "VS Code 扩展 / JetBrains 插件", link: "/vsce" },
  { text: "桌面版", link: "/desktop" },
  { text: "CLI", link: "/cli" },
  { text: "SDK", link: "/sdk" },
  { text: "规格说明", link: "/specs/" },
];

// specs sidebar: generated from docs/specs/<group>/*.md, ordered the same as
// the index table (frontmatter `order`, then path) — see spec-stats.mjs
const specsSidebar = collectSpecs().groups.map(({ dir, text, specs }) => ({
  text,
  collapsed: true,
  items: specs.map(({ path: rel }) => ({
    text: specTitle(
      fs.readFileSync(path.join(SPECS_DIR, rel), "utf-8"),
      rel.replace(/.*\//, "").replace(/\.md$/, ""),
    ),
    link: `/specs/${rel.replace(/\.md$/, "")}`,
  })),
}));

export default {
  base: "/wave-agent/",
  title: "CodeChat",
  description: "AI 辅助编程工具链 — SDK、CLI、VS Code 扩展与 JetBrains 插件",
  themeConfig: {
    nav,
    search: { provider: "local" },
    sidebar: {
      "/specs/": specsSidebar,
      "/guide": [
        {
          text: "管控台使用说明",
          collapsed: false,
          items: [
            { text: "一、企业管理员账号开通", link: "/guide#admin-account" },
            { text: "二、下载插件", link: "/guide#download-plugin" },
            { text: "三、添加团队成员", link: "/guide#add-members" },
            {
              text: "方式一：通过邀请链接邀请成员加入",
              link: "/guide#invite-link",
            },
            { text: "方式二：配置 SSO 登录", link: "/guide#sso-login" },
            { text: "四、查看积分", link: "/guide#view-credits" },
          ],
        },
      ],
      "/vsce": [
        {
          text: "1. 核心聊天体验",
          collapsed: false,
          items: [
            { text: "1.1 基础对话", link: "/vsce#basic-chat" },
            { text: "1.2 AI 思考过程", link: "/vsce#ai-reasoning" },
            { text: "1.3 用户消息吸顶", link: "/vsce#sticky-user-message" },
          ],
        },
        {
          text: "2. 智能输入与上下文",
          collapsed: false,
          items: [
            { text: "2.1 消息队列", link: "/vsce#message-queuing" },
            { text: "2.2 历史提示词", link: "/vsce#history-search" },
            {
              text: "2.3 代码选择与引用",
              link: "/vsce#code-selection-reference",
            },
            { text: "2.4 指令系统", link: "/vsce#slash-commands" },
            { text: "2.5 文件建议与预览", link: "/vsce#file-suggestions" },
            { text: "2.6 Bash 模式", link: "/vsce#bash-mode" },
            { text: "2.7 输入框外观与状态", link: "/vsce#input-box" },
            { text: "2.8 旁路提问", link: "/vsce#btw" },
            { text: "2.9 压缩对话", link: "/vsce#compact" },
          ],
        },
        {
          text: "3. 代码理解与操作",
          collapsed: false,
          items: [
            { text: "3.1 终端工具", link: "/vsce#bash-tool" },
            { text: "3.2 文件搜索与探索", link: "/vsce#file-exploration" },
            { text: "3.3 文件操作工具", link: "/vsce#file-operations" },
            { text: "3.4 文件差异对比", link: "/vsce#diff-viewer" },
            { text: "3.5 LSP 代码智能", link: "/vsce#lsp-intelligence" },
            { text: "3.6 视觉理解", link: "/vsce#vision-understanding" },
          ],
        },
        {
          text: "4. 权限与安全",
          collapsed: false,
          items: [
            { text: "4.1 权限模式管理", link: "/vsce#permission-modes" },
            { text: "4.2 代码修改确认", link: "/vsce#code-edit-confirmation" },
            {
              text: "4.3 命令执行确认",
              link: "/vsce#bash-command-confirmation",
            },
            { text: "4.4 MCP 工具确认", link: "/vsce#mcp-tool-confirmation" },
            { text: "4.5 计划执行确认", link: "/vsce#plan-confirmation" },
            { text: "4.6 进入计划模式确认", link: "/vsce#enter-plan-mode" },
            { text: "4.7 交互式提问", link: "/vsce#ask-user" },
            { text: "4.8 错误消息展示", link: "/vsce#error-message-display" },
            { text: "4.9 确认反馈机制", link: "/vsce#confirmation-feedback" },
          ],
        },
        {
          text: "5. 任务管理",
          collapsed: false,
          items: [
            { text: "5.1 任务列表", link: "/vsce#task-list" },
            { text: "5.2 后台任务通知", link: "/vsce#task-notification" },
            {
              text: "5.3 后台任务系统",
              link: "/vsce#mechanism-background-tasks",
            },
            {
              text: "5.4 后台任务管理对话框",
              link: "/vsce#background-task-manager",
            },
            { text: "5.5 工作流管理对话框", link: "/vsce#workflow-manager" },
          ],
        },
        {
          text: "6. 多 Agents 与并发",
          collapsed: false,
          items: [
            { text: "6.1 Agents 对话框", link: "/vsce#agents-dialog" },
            { text: "6.2 Skills 对话框", link: "/vsce#skills-dialog" },
            { text: "6.3 并发使用子代理", link: "/vsce#subagent-concurrency" },
            { text: "6.4 多对话并行", link: "/vsce#parallel-conversations" },
            {
              text: "6.5 通过 Worktree 创建隔离环境",
              link: "/vsce#worktree-concurrency",
            },
          ],
        },
        {
          text: "7. 能力扩展",
          collapsed: false,
          items: [
            { text: "7.1 子代理状态", link: "/vsce#subagent-display" },
            { text: "7.2 Skill 技能系统", link: "/vsce#skill-system" },
            { text: "7.3 MCP 协议集成", link: "/vsce#mcp-integration" },
          ],
        },
        {
          text: "8. 会话与持久化",
          collapsed: true,
          items: [
            { text: "8.1 对话回滚", link: "/vsce#rewind-feature" },
            { text: "8.2 会话管理", link: "/vsce#session-management" },
          ],
        },
        {
          text: "9. 配置管理",
          collapsed: false,
          items: [
            { text: "9.1 配置设置", link: "/vsce#configuration-settings" },
            { text: "9.2 语言设置", link: "/vsce#language-settings" },
          ],
        },
        {
          text: "10. 插件系统",
          collapsed: false,
          items: [
            { text: "10.1 概述", link: "/vsce#plugin-overview" },
            { text: "10.2 探索新插件", link: "/vsce#explore-plugins" },
            { text: "10.3 已激活插件", link: "/vsce#installed-plugins" },
            {
              text: "10.4 内置插件：规格驱动开发（SDD）",
              link: "/vsce#sdd-plugin",
            },
            {
              text: "10.5 规格驱动开发工作流",
              link: "/vsce#sdd-workflow",
            },
          ],
        },
        {
          text: "产品特色总结",
          collapsed: false,
          items: [
            { text: "产品特色总结", link: "/vsce#product-features-summary" },
          ],
        },
      ],
      "/desktop": [
        {
          text: "桌面版",
          collapsed: false,
          items: [
            {
              text: "首次启动：选择工作目录",
              link: "/desktop#首次启动选择工作目录",
            },
            { text: "SSH 远程主机", link: "/desktop#ssh-远程主机" },
            { text: "远程会话的面板", link: "/desktop#远程会话的面板" },
            { text: "侧边栏会话树", link: "/desktop#侧边栏会话树" },
            { text: "侧边栏「更多」菜单", link: "/desktop#侧边栏更多菜单" },
            {
              text: "基于分支的 worktree 隔离会话",
              link: "/desktop#基于分支的-worktree-隔离会话",
            },
            { text: "会话切换快捷键", link: "/desktop#会话切换快捷键" },
            { text: "权限模式快捷键", link: "/desktop#权限模式快捷键" },
            { text: "并排多对话（分屏）", link: "/desktop#并排多对话分屏" },
            { text: "对话级面板开关", link: "/desktop#对话级面板开关" },
            { text: "差异面板", link: "/desktop#差异面板" },
            { text: "文件面板", link: "/desktop#文件面板" },
            { text: "终端面板", link: "/desktop#终端面板" },
            {
              text: "localhost 原型预览与元素评论",
              link: "/desktop#localhost-原型预览与元素评论",
            },
            { text: "核心交互", link: "/desktop#核心交互" },
            { text: "内置 CLI", link: "/desktop#内置-cli" },
            { text: "自动更新", link: "/desktop#自动更新" },
            { text: "登录", link: "/desktop#登录" },
          ],
        },
      ],
      "/cli": [
        {
          text: "1. 安装与启动",
          collapsed: false,
          items: [
            { text: "1.1 安装", link: "/cli#install" },
            { text: "1.2 运行模式", link: "/cli#run-modes" },
          ],
        },
        {
          text: "2. 命令行选项",
          collapsed: false,
          items: [
            { text: "2.1 会话控制", link: "/cli#session-options" },
            { text: "2.2 模型与工具", link: "/cli#model-tool-options" },
            { text: "2.3 权限与安全", link: "/cli#permission-options" },
            { text: "2.4 工作目录", link: "/cli#worktree-options" },
            { text: "2.5 其他", link: "/cli#misc-options" },
          ],
        },
        {
          text: "3. 子命令",
          collapsed: false,
          items: [
            { text: "3.1 插件管理", link: "/cli#plugin-commands" },
            { text: "3.2 更新", link: "/cli#update-command" },
            { text: "3.3 Daemon 客户端命令", link: "/cli#daemon-commands" },
          ],
        },
        {
          text: "4. 斜杠命令",
          collapsed: false,
          items: [{ text: "命令列表", link: "/cli#slash-commands" }],
        },
        {
          text: "5. 键盘快捷键",
          collapsed: false,
          items: [
            { text: "5.1 输入与导航", link: "/cli#input-navigation" },
            { text: "5.2 视图控制", link: "/cli#view-control" },
            { text: "5.3 权限与确认", link: "/cli#permission-control" },
          ],
        },
        {
          text: "6. 权限模式",
          collapsed: false,
          items: [{ text: "模式说明", link: "/cli#permission-modes" }],
        },
        {
          text: "7. 特色功能",
          collapsed: false,
          items: [
            { text: "7.1 Bash 模式", link: "/cli#bash-mode" },
            { text: "7.2 BTW 旁路提问", link: "/cli#btw" },
            { text: "7.3 Git Worktree", link: "/cli#worktree" },
            { text: "7.4 Compact 压缩", link: "/cli#compact" },
            { text: "7.5 Rewind 回滚", link: "/cli#rewind" },
            { text: "7.6 图片粘贴", link: "/cli#image-paste" },
            { text: "7.7 MCP 集成", link: "/cli#mcp" },
            { text: "7.8 插件系统", link: "/cli#plugin" },
            { text: "7.9 Workflow 工作流", link: "/cli#workflow" },
            { text: "7.10 后台任务", link: "/cli#background-tasks" },
            { text: "7.11 SSO 认证", link: "/cli#sso" },
            { text: "7.12 会话管理", link: "/cli#session-management" },
            {
              text: "7.13 附加工作目录",
              link: "/cli#additional-working-directories",
            },
            { text: "7.14 Token 用量统计", link: "/cli#token-stats" },
          ],
        },
        {
          text: "8. 环境变量",
          collapsed: true,
          items: [{ text: "配置列表", link: "/cli#environment-variables" }],
        },
      ],
      "/sdk": [
        {
          text: "1. 快速开始",
          collapsed: false,
          items: [
            { text: "安装", link: "/sdk#install" },
            { text: "核心能力", link: "/sdk#capabilities" },
            { text: "基本用法", link: "/sdk#basic-usage" },
          ],
        },
        {
          text: "2. Agent 生命周期",
          collapsed: false,
          items: [
            { text: "创建 Agent", link: "/sdk#agent-create" },
            { text: "配置选项", link: "/sdk#agent-options" },
            { text: "Agent 属性", link: "/sdk#agent-properties" },
            { text: "Agent 常用方法", link: "/sdk#agent-methods" },
            { text: "销毁 Agent", link: "/sdk#agent-destroy" },
          ],
        },
        {
          text: "3. 消息处理",
          collapsed: false,
          items: [
            { text: "发送消息", link: "/sdk#send-message" },
            { text: "消息队列", link: "/sdk#message-queue" },
            { text: "消息类型", link: "/sdk#message-types" },
            { text: "流式输出", link: "/sdk#streaming" },
          ],
        },
        {
          text: "4. 回调系统",
          collapsed: false,
          items: [
            {
              text: "AgentCallbacks 接口",
              link: "/sdk#agent-callbacks-interface",
            },
            { text: "消息回调", link: "/sdk#callbacks-messaging" },
            { text: "后台任务回调", link: "/sdk#callbacks-background" },
            { text: "子代理回调", link: "/sdk#callbacks-subagent" },
            { text: "MCP 回调", link: "/sdk#callbacks-mcp" },
            { text: "UI 状态回调", link: "/sdk#callbacks-ui" },
          ],
        },
        {
          text: "5. 工具系统",
          collapsed: false,
          items: [
            { text: "内置工具", link: "/sdk#builtin-tools" },
            { text: "工具详情", link: "/sdk#tool-details" },
            { text: "自定义工具", link: "/sdk#custom-tools" },
            { text: "权限管理", link: "/sdk#permissions" },
            { text: "工具名常量", link: "/sdk#tool-name-constants" },
          ],
        },
        {
          text: "6. 会话管理",
          collapsed: false,
          items: [
            { text: "创建会话", link: "/sdk#session-create" },
            { text: "恢复会话", link: "/sdk#session-restore" },
            { text: "会话 API", link: "/sdk#session-api" },
            { text: "会话历史操作", link: "/sdk#session-history" },
            { text: "文件存储", link: "/sdk#session-storage" },
          ],
        },
        {
          text: "7. 插件系统",
          collapsed: false,
          items: [
            { text: "插件配置", link: "/sdk#plugin-config" },
            { text: "插件管理", link: "/sdk#plugin-management" },
            { text: "Marketplace 集成", link: "/sdk#marketplace" },
          ],
        },
        {
          text: "8. MCP 集成",
          collapsed: false,
          items: [
            { text: "配置方式", link: "/sdk#mcp-config" },
            { text: "管理 API", link: "/sdk#mcp-api" },
            { text: "状态回调", link: "/sdk#mcp-callbacks" },
          ],
        },
        {
          text: "9. 记忆系统",
          collapsed: true,
          items: [
            { text: "AGENTS.md", link: "/sdk#agents-md" },
            { text: "自动记忆", link: "/sdk#auto-memory" },
            { text: "记忆规则", link: "/sdk#memory-rules" },
            { text: "记忆 API", link: "/sdk#memory-api" },
            { text: "消息压缩", link: "/sdk#compact" },
          ],
        },
        {
          text: "10. 后台任务与工作流",
          collapsed: false,
          items: [
            { text: "后台任务", link: "/sdk#background-task-management" },
            { text: "后台任务完成通知", link: "/sdk#task-notification" },
            { text: "前台任务", link: "/sdk#foreground-tasks" },
            { text: "任务状态回调", link: "/sdk#task-callbacks" },
            { text: "工作流", link: "/sdk#workflow-management" },
          ],
        },
        {
          text: "11. 其他功能",
          collapsed: true,
          items: [
            { text: "斜杠命令", link: "/sdk#slash-commands" },
            { text: "Bash 模式命令", link: "/sdk#bash-mode" },
            { text: "SSO 认证", link: "/sdk#sso" },
            { text: "提示历史", link: "/sdk#prompt-history" },
            { text: "Git 工具", link: "/sdk#git-utils" },
            { text: "文件搜索", link: "/sdk#file-search" },
            { text: "计划模式", link: "/sdk#plan-mode" },
            { text: "Worktree 管理", link: "/sdk#worktree" },
          ],
        },
        {
          text: "12. 内置 Skills",
          collapsed: false,
          items: [
            { text: "settings — 配置管理", link: "/sdk#skill-settings" },
            { text: "init — 代码库初始化", link: "/sdk#skill-init" },
            { text: "loop — 定时循环任务", link: "/sdk#skill-loop" },
            { text: "simplify — 代码简化与清理", link: "/sdk#skill-simplify" },
            { text: "code-review — 代码审查", link: "/sdk#skill-code-review" },
            {
              text: "deep-research — 深度主题调研",
              link: "/sdk#skill-deep-research",
            },
            { text: "artifact — 发布可分享网页", link: "/sdk#skill-artifact" },
          ],
        },
        {
          text: "13. 内置 Subagents",
          collapsed: false,
          items: [
            { text: "Bash — 命令执行", link: "/sdk#subagent-bash" },
            { text: "Explore — 代码库探索", link: "/sdk#subagent-explore" },
            { text: "Plan — 软件架构师", link: "/sdk#subagent-plan" },
            { text: "通用代理", link: "/sdk#subagent-general-purpose" },
            { text: "Vision — 图像识别", link: "/sdk#subagent-vision" },
          ],
        },
        {
          text: "14. Settings Skill",
          collapsed: true,
          items: [
            { text: "settings.json 配置中心", link: "/sdk#settings-json" },
            { text: "钩子 (Hooks)", link: "/sdk#settings-hooks" },
            { text: "环境变量", link: "/sdk#settings-env" },
            { text: "工具权限", link: "/sdk#settings-permissions" },
            { text: "模型配置", link: "/sdk#settings-models" },
            { text: "模型能力配置", link: "/sdk#settings-capabilities" },
            { text: "MCP 协议", link: "/sdk#settings-mcp" },
            { text: "记忆规则", link: "/sdk#settings-memory" },
            { text: "自定义 Skill", link: "/sdk#settings-skills" },
            { text: "子代理", link: "/sdk#settings-subagents" },
            { text: "插件配置", link: "/sdk#settings-plugins" },
            { text: "其他设置", link: "/sdk#settings-other" },
          ],
        },
        {
          text: "15. 官方插件市场",
          collapsed: true,
          items: [
            { text: "document-skills", link: "/sdk#plugin-document-skills" },
            { text: "typescript-lsp", link: "/sdk#plugin-typescript-lsp" },
            { text: "chrome-devtools", link: "/sdk#plugin-chrome-devtools" },
            { text: "code2spec", link: "/sdk#plugin-code2spec" },
            { text: "code2cwspec", link: "/sdk#plugin-code2cwspec" },
            { text: "commit-skills", link: "/sdk#plugin-commit-skills" },
            { text: "speckit", link: "/sdk#plugin-speckit" },
            { text: "deep-wiki", link: "/sdk#plugin-deep-wiki" },
            { text: "tavily-search", link: "/sdk#plugin-tavily-search" },
            { text: "frontend-design", link: "/sdk#plugin-frontend-design" },
            { text: "superpowers", link: "/sdk#plugin-superpowers" },
          ],
        },
        {
          text: "16. OpenTelemetry 遥测",
          collapsed: true,
          items: [
            { text: "导出器", link: "/sdk#otel-exporters" },
            { text: "Span 体系", link: "/sdk#otel-spans" },
            { text: "事件日志", link: "/sdk#otel-events" },
            { text: "PII 保护", link: "/sdk#otel-privacy" },
            { text: "可靠性保障", link: "/sdk#otel-reliability" },
          ],
        },
      ],
    },
  },
  head: [["link", { rel: "icon", href: "LOGO.png" }]],
};
