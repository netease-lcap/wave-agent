import fs from "node:fs";
import path from "node:path";
import { SPECS_DIR, specTitle, collectSpecs } from "./spec-stats.mjs";

const nav = [
  { text: "产品概览", link: "/" },
  { text: "教程&最佳实践", link: "/tutorials" },
  { text: "桌面端", link: "/desktop" },
  { text: "VSCode/JetBrains插件", link: "/vsce" },
  { text: "CLI", link: "/cli" },
  { text: "SDK", link: "/sdk" },
  { text: "企业管控台", link: "/guide" },
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
  title: "CodeWave IDE",
  description: "AI 辅助编程工具链 — SDK、CLI、VS Code 扩展与 JetBrains 插件",
  themeConfig: {
    nav,
    search: { provider: "local" },
    sidebar: {
      "/specs/": specsSidebar,
      "/index": [
        {
          text: "产品概览",
          collapsed: false,
          items: [
            { text: "产品矩阵：五种形态", link: "/#产品矩阵-五种形态" },
            { text: "使用场景", link: "/#使用场景" },
            { text: "支持的操作系统", link: "/#支持的操作系统" },
          ],
        },
      ],
      "/tutorials": [
        {
          text: "一、研发场景实用工具推荐",
          link: "/tutorials#一、研发场景实用工具推荐",
          collapsed: false,
          items: [
            { text: "需求与规划", link: "/tutorials#_1-需求与规划" },
            { text: "编码实现", link: "/tutorials#_2-编码实现" },
            { text: "代码质量与提交", link: "/tutorials#_3-代码质量与提交" },
            { text: "测试与调试", link: "/tutorials#_4-测试与调试" },
            { text: "文档与知识沉淀", link: "/tutorials#_5-文档与知识沉淀" },
            { text: "调研与日常效率", link: "/tutorials#_6-调研与日常效率" },
          ],
        },
        {
          text: "二、将 Figma 设计稿转化为前端代码",
          link: "/tutorials#二、将-figma-设计稿转化为前端代码",
          collapsed: false,
          items: [
            {
              text: "准备：获取 Figma Access Token",
              link: "/tutorials#_1-准备-获取-figma-access-token",
            },
            {
              text: "在 CodeWave IDE 中添加 Figma MCP 服务器",
              link: "/tutorials#_2-在-codewave-ide-中添加-figma-mcp-服务器",
            },
            {
              text: "对话中粘贴设计稿链接，提出需求",
              link: "/tutorials#_3-对话中粘贴设计稿链接-提出需求",
            },
            { text: "预览与迭代", link: "/tutorials#_4-预览与迭代" },
            { text: "常见问题", link: "/tutorials#常见问题" },
          ],
        },
        {
          text: "三、SDD开发案例",
          link: "/tutorials#三、sdd开发案例",
          collapsed: false,
          items: [
            { text: "启用 SDD 插件", link: "/tutorials#_1-启用-sdd-插件" },
            {
              text: "规格驱动开发工作流",
              link: "/tutorials#_2-规格驱动开发工作流",
            },
            { text: "实际产出统计", link: "/tutorials#_3-实际产出统计" },
          ],
        },
        {
          text: "四、实现网页自动化测试",
          link: "/tutorials#四、实现网页自动化测试",
          collapsed: false,
          items: [
            {
              text: "安装 chrome-devtools 插件",
              link: "/tutorials#_1-安装-chrome-devtools-插件",
            },
            {
              text: "对话驱动自动化测试",
              link: "/tutorials#_2-对话驱动自动化测试",
            },
            { text: "常用测试指令", link: "/tutorials#_3-常用测试指令" },
            { text: "测试报告与回归", link: "/tutorials#_4-测试报告与回归" },
          ],
        },
      ],
      "/guide": [
        {
          text: "管控台使用说明",
          collapsed: false,
          items: [
            { text: "一、企业管理员账号开通", link: "/guide#admin-account" },
            { text: "二、添加团队成员", link: "/guide#add-members" },
            {
              text: "方式一：通过邀请链接邀请成员加入",
              link: "/guide#invite-link",
            },
            { text: "方式二：配置 SSO 登录", link: "/guide#sso-login" },
            { text: "三、查看积分", link: "/guide#view-credits" },
            { text: "四、用量统计", link: "/guide#usage-stats" },
            { text: "套餐产品", link: "/guide#套餐产品" },
            { text: "API 额度", link: "/guide#api-额度" },
            { text: "使用明细", link: "/guide#使用明细" },
            { text: "五、订单管理", link: "/guide#orders" },
          ],
        },
      ],
      "/vsce": [
        {
          text: "插件使用文档",
          collapsed: false,
          items: [
            {
              text: "快速入门",
              link: "/vsce#快速入门",
              collapsed: false,
              items: [
                { text: "VS Code 扩展", link: "/vsce#vs-code-扩展" },
                { text: "JetBrains 插件", link: "/vsce#jetbrains-插件" },
              ],
            },
            {
              text: "画廊",
              collapsed: false,
              items: [
                {
                  text: "1. 核心聊天体验",
                  link: "/vsce#_1-核心聊天体验",
                },
                {
                  text: "2. 智能输入与上下文",
                  link: "/vsce#_2-智能输入与上下文",
                },
                {
                  text: "3. 代码理解与操作",
                  link: "/vsce#_3-代码理解与操作",
                },
                { text: "4. 权限与安全", link: "/vsce#_4-权限与安全" },
                { text: "5. 任务管理", link: "/vsce#_5-任务管理" },
                {
                  text: "6. 多 Agents 与并发",
                  link: "/vsce#_6-多-agents-与并发",
                },
                { text: "7. 能力扩展", link: "/vsce#_7-能力扩展" },
                { text: "8. 会话与持久化", link: "/vsce#_8-会话与持久化" },
                { text: "9. 配置管理", link: "/vsce#_9-配置管理" },
                { text: "10. 插件系统", link: "/vsce#_10-插件系统" },
              ],
            },
          ],
        },
      ],
      "/desktop": [
        {
          text: "1. 快速开始",
          collapsed: false,
          items: [
            {
              text: "1.1 安装 CodeWave IDE 桌面端",
              link: "/desktop#_1-1-安装-codewave-ide-桌面端",
            },
            { text: "1.2 打开项目", link: "/desktop#_1-2-打开项目" },
            { text: "1.3 智能输入", link: "/desktop#_1-3-智能输入" },
            { text: "1.4 面板介绍", link: "/desktop#_1-4-面板介绍" },
          ],
        },
        {
          text: "2. Agent核心",
          collapsed: false,
          items: [
            { text: "2.1 对话", link: "/desktop#_2-1-对话" },
            { text: "2.2 模型", link: "/desktop#_2-2-模型" },
            { text: "2.3 上下文", link: "/desktop#_2-3-上下文" },
            {
              text: "2.4 代码理解与操作",
              link: "/desktop#_2-4-代码理解与操作",
            },
            { text: "2.5 权限与安全", link: "/desktop#_2-5-权限与安全" },
            { text: "2.6 任务管理", link: "/desktop#_2-6-任务管理" },
            { text: "2.7 多Agent与并发", link: "/desktop#_2-7-多agent与并发" },
            { text: "2.8 SubAgent", link: "/desktop#_2-8-subagent" },
            { text: "2.9 技能", link: "/desktop#_2-9-技能" },
            { text: "2.10 记忆", link: "/desktop#_2-10-记忆" },
            {
              text: "2.11 工作流（WorkFlow）",
              link: "/desktop#_2-11-工作流-workflow",
            },
          ],
        },
        {
          text: "3. 自动化",
          collapsed: false,
          items: [
            { text: "3.1 钩子（Hooks）", link: "/desktop#_3-1-钩子-hooks" },
            {
              text: "3.2 定时循环任务（loop）",
              link: "/desktop#_3-2-定时循环任务-loop",
            },
          ],
        },
        {
          text: "4. 编程辅助",
          collapsed: false,
          items: [
            { text: "4.1 SDD", link: "/desktop#_4-1-sdd" },
            {
              text: "4.2 Localhost原型预览与元素评论",
              link: "/desktop#_4-2-localhost原型预览与元素评论",
            },
            {
              text: "4.3 Artifacts产物分享",
              link: "/desktop#_4-3-artifacts产物分享",
            },
          ],
        },
        {
          text: "5. 扩展",
          collapsed: false,
          items: [
            { text: "5.1 MCP", link: "/desktop#_5-1-mcp" },
            { text: "5.2 插件", link: "/desktop#_5-2-插件" },
          ],
        },
        {
          text: "6. 设置",
          collapsed: false,
          items: [
            {
              text: "6.1 账户卡片与设置入口",
              link: "/desktop#_6-1-账户卡片与设置入口",
            },
            { text: "6.2 全局设置", link: "/desktop#_6-2-全局设置" },
            { text: "6.3 个性化", link: "/desktop#_6-3-个性化" },
            { text: "6.4 项目设置", link: "/desktop#_6-4-项目设置" },
            {
              text: "6.5 技能、子代理、钩子与 MCP 服务",
              link: "/desktop#_6-5-技能、子代理、钩子与-mcp-服务",
            },
            { text: "6.6 更新", link: "/desktop#_6-6-更新" },
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
