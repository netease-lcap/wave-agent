export default {
  base: '/wave-agent/',
  title: 'Wave Agent',
  description: 'AI 辅助编程工具链 — SDK、CLI 与 VS Code 扩展',
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: 'VS Code 扩展', link: '/vsce' },
      { text: 'CLI', link: '/cli' },
      { text: 'SDK', link: '/sdk' },
    ],
    sidebar: {
      '/vsce': [
        {
          text: '1. 核心聊天体验',
          collapsed: false,
          items: [
            { text: '1.1 欢迎界面', link: '/vsce#welcome-interface' },
            { text: '1.2 基础对话', link: '/vsce#basic-chat' },
            { text: '1.3 工具提示', link: '/vsce#tooltips' },
          ],
        },
        {
          text: '2. 智能输入与上下文',
          collapsed: false,
          items: [
            { text: '2.1 消息队列', link: '/vsce#message-queuing' },
            { text: '2.2 历史记录搜索', link: '/vsce#history-search' },
            { text: '2.3 代码选择与引用', link: '/vsce#code-selection-reference' },
            { text: '2.4 指令系统', link: '/vsce#slash-commands' },
            { text: '2.5 文件建议与预览', link: '/vsce#file-suggestions' },
            { text: '2.6 快捷终端命令', link: '/vsce#bang-shell-command' },
          ],
        },
        {
          text: '3. 代码理解与操作',
          collapsed: false,
          items: [
            { text: '3.1 终端工具', link: '/vsce#bash-tool' },
            { text: '3.2 文件搜索与探索', link: '/vsce#file-exploration' },
            { text: '3.3 文件操作工具', link: '/vsce#file-operations' },
            { text: '3.4 文件差异对比', link: '/vsce#diff-viewer' },
            { text: '3.5 LSP 代码智能', link: '/vsce#lsp-intelligence' },
            { text: '3.6 视觉理解', link: '/vsce#vision-understanding' },
          ],
        },
        {
          text: '4. 权限与安全',
          collapsed: false,
          items: [
            { text: '4.1 权限模式管理', link: '/vsce#permission-modes' },
            { text: '4.2 代码修改确认', link: '/vsce#code-edit-confirmation' },
            { text: '4.3 命令执行确认', link: '/vsce#bash-command-confirmation' },
            { text: '4.4 计划执行确认', link: '/vsce#plan-confirmation' },
            { text: '4.5 进入计划模式确认', link: '/vsce#enter-plan-mode' },
            { text: '4.6 错误消息展示', link: '/vsce#error-message-display' },
          ],
        },
        {
          text: '5. 任务管理',
          collapsed: false,
          items: [
            { text: '5.1 任务列表', link: '/vsce#task-list' },
            { text: '5.2 后台任务通知', link: '/vsce#task-notification' },
            { text: '5.3 后台任务系统', link: '/vsce#mechanism-background-tasks' },
          ],
        },
        {
          text: '6. 能力扩展',
          collapsed: false,
          items: [
            { text: '6.1 子代理状态', link: '/vsce#subagent-display' },
            { text: '6.2 Skill 技能系统', link: '/vsce#skill-system' },
            { text: '6.3 MCP 协议集成', link: '/vsce#mcp-integration' },
          ],
        },
        {
          text: '7. AI 表达与交互',
          collapsed: false,
          items: [
            { text: '7.1 Mermaid 图表渲染', link: '/vsce#mermaid-rendering' },
            { text: '7.2 交互式提问', link: '/vsce#ask-user' },
            { text: '7.3 AI 思考过程', link: '/vsce#ai-reasoning' },
          ],
        },
        {
          text: '8. 会话与持久化',
          collapsed: true,
          items: [
            { text: '8.1 对话回滚', link: '/vsce#rewind-feature' },
            { text: '8.2 会话管理', link: '/vsce#session-management' },
          ],
        },
        {
          text: '9. 配置管理',
          collapsed: false,
          items: [
            { text: '9.1 配置设置', link: '/vsce#configuration-settings' },
            { text: '9.2 语言设置', link: '/vsce#language-settings' },
          ],
        },
        {
          text: '10. 插件系统',
          collapsed: false,
          items: [
            { text: '10.1 概述', link: '/vsce#plugin-overview' },
            { text: '10.2 探索新插件', link: '/vsce#explore-plugins' },
            { text: '10.3 已激活插件', link: '/vsce#installed-plugins' },
          ],
        },
      ],
      '/cli': [
        {
          text: '1. 安装与启动',
          collapsed: false,
          items: [
            { text: '1.1 安装', link: '/cli#install' },
            { text: '1.2 运行模式', link: '/cli#run-modes' },
          ],
        },
        {
          text: '2. 命令行选项',
          collapsed: false,
          items: [
            { text: '2.1 会话控制', link: '/cli#session-options' },
            { text: '2.2 模型与工具', link: '/cli#model-tool-options' },
            { text: '2.3 权限与安全', link: '/cli#permission-options' },
            { text: '2.4 工作目录', link: '/cli#worktree-options' },
            { text: '2.5 其他', link: '/cli#misc-options' },
          ],
        },
        {
          text: '3. 子命令',
          collapsed: false,
          items: [
            { text: '3.1 插件管理', link: '/cli#plugin-commands' },
            { text: '3.2 更新', link: '/cli#update-command' },
          ],
        },
        {
          text: '4. 斜杠命令',
          collapsed: false,
          items: [
            { text: '命令列表', link: '/cli#slash-commands' },
          ],
        },
        {
          text: '5. 键盘快捷键',
          collapsed: false,
          items: [
            { text: '5.1 输入与导航', link: '/cli#input-navigation' },
            { text: '5.2 视图控制', link: '/cli#view-control' },
            { text: '5.3 权限与确认', link: '/cli#permission-control' },
          ],
        },
        {
          text: '6. 权限模式',
          collapsed: false,
          items: [
            { text: '模式说明', link: '/cli#permission-modes' },
          ],
        },
        {
          text: '7. 特色功能',
          collapsed: false,
          items: [
            { text: '7.1 Bang 命令', link: '/cli#bang-command' },
            { text: '7.2 BTW 旁路提问', link: '/cli#btw' },
            { text: '7.3 Git Worktree', link: '/cli#worktree' },
            { text: '7.4 Goal 自主目标', link: '/cli#goal' },
            { text: '7.5 Compact 压缩', link: '/cli#compact' },
            { text: '7.6 Rewind 回滚', link: '/cli#rewind' },
            { text: '7.7 图片粘贴', link: '/cli#image-paste' },
            { text: '7.8 MCP 集成', link: '/cli#mcp' },
            { text: '7.9 插件系统', link: '/cli#plugin' },
            { text: '7.10 Workflow 工作流', link: '/cli#workflow' },
            { text: '7.11 后台任务', link: '/cli#background-tasks' },
            { text: '7.12 SSO 认证', link: '/cli#sso' },
            { text: '7.13 会话管理', link: '/cli#session-management' },
            { text: '7.14 Token 用量统计', link: '/cli#token-stats' },
          ],
        },
        {
          text: '8. 环境变量',
          collapsed: true,
          items: [
            { text: '配置列表', link: '/cli#environment-variables' },
          ],
        },
        {
          text: '9. 开发',
          collapsed: true,
          items: [
            { text: '构建与测试', link: '/cli#development' },
          ],
        },
      ],
      '/sdk': [
        {
          text: '1. 快速开始',
          collapsed: false,
          items: [
            { text: '安装', link: '/sdk#install' },
            { text: '核心能力', link: '/sdk#capabilities' },
            { text: '基本用法', link: '/sdk#basic-usage' },
            { text: '开发', link: '/sdk#development' },
          ],
        },
        {
          text: '2. Agent 生命周期',
          collapsed: false,
          items: [
            { text: '创建 Agent', link: '/sdk#agent-create' },
            { text: '配置选项', link: '/sdk#agent-options' },
            { text: '销毁 Agent', link: '/sdk#agent-destroy' },
          ],
        },
        {
          text: '3. 消息处理',
          collapsed: false,
          items: [
            { text: '发送消息', link: '/sdk#send-message' },
            { text: '消息队列', link: '/sdk#message-queue' },
            { text: '消息类型', link: '/sdk#message-types' },
          ],
        },
        {
          text: '4. 回调系统',
          collapsed: false,
          items: [
            { text: 'AgentCallbacks 接口', link: '/sdk#agent-callbacks-interface' },
            { text: '消息回调', link: '/sdk#callbacks-messaging' },
            { text: '后台任务回调', link: '/sdk#callbacks-background' },
            { text: 'MCP 回调', link: '/sdk#callbacks-mcp' },
            { text: 'UI 状态回调', link: '/sdk#callbacks-ui' },
          ],
        },
        {
          text: '5. 工具系统',
          collapsed: false,
          items: [
            { text: '内置工具', link: '/sdk#builtin-tools' },
            { text: '自定义工具', link: '/sdk#custom-tools' },
            { text: '权限管理', link: '/sdk#permissions' },
            { text: '工具名常量', link: '/sdk#tool-name-constants' },
          ],
        },
        {
          text: '6. 会话管理',
          collapsed: false,
          items: [
            { text: '创建会话', link: '/sdk#session-create' },
            { text: '恢复会话', link: '/sdk#session-restore' },
            { text: '会话 API', link: '/sdk#session-api' },
            { text: '文件存储', link: '/sdk#session-storage' },
          ],
        },
        {
          text: '7. 插件系统',
          collapsed: false,
          items: [
            { text: '插件配置', link: '/sdk#plugin-config' },
            { text: '插件管理', link: '/sdk#plugin-management' },
          ],
        },
        {
          text: '8. MCP 集成',
          collapsed: false,
          items: [
            { text: '配置方式', link: '/sdk#mcp-config' },
            { text: '管理 API', link: '/sdk#mcp-api' },
          ],
        },
        {
          text: '9. 记忆系统',
          collapsed: true,
          items: [
            { text: 'AGENTS.md', link: '/sdk#agents-md' },
            { text: '自动记忆', link: '/sdk#auto-memory' },
            { text: '记忆规则', link: '/sdk#memory-rules' },
            { text: '消息压缩', link: '/sdk#compact' },
          ],
        },
        {
          text: '10. 后台任务与工作流',
          collapsed: false,
          items: [
            { text: '后台任务', link: '/sdk#background-task-management' },
            { text: '工作流', link: '/sdk#workflow-management' },
          ],
        },
        {
          text: '11. 其他功能',
          collapsed: true,
          items: [
            { text: '目标管理', link: '/sdk#goal' },
            { text: '斜杠命令', link: '/sdk#slash-commands' },
            { text: 'SSO 认证', link: '/sdk#sso' },
            { text: 'Git 工具', link: '/sdk#git-utils' },
          ],
        },
        {
          text: '12. 内置 Skills',
          collapsed: false,
          items: [
            { text: 'settings — 配置管理', link: '/sdk#skill-settings' },
            { text: 'init — 代码库初始化', link: '/sdk#skill-init' },
            { text: 'loop — 定时循环任务', link: '/sdk#skill-loop' },
          ],
        },
        {
          text: '13. 内置 Subagents',
          collapsed: false,
          items: [
            { text: 'Bash — 命令执行', link: '/sdk#subagent-bash' },
            { text: 'Explore — 代码库探索', link: '/sdk#subagent-explore' },
            { text: 'Plan — 软件架构师', link: '/sdk#subagent-plan' },
            { text: '通用代理', link: '/sdk#subagent-general-purpose' },
          ],
        },
        {
          text: '14. Settings Skill',
          collapsed: true,
          items: [
            { text: 'settings.json 配置中心', link: '/sdk#settings-json' },
            { text: '钩子 (Hooks)', link: '/sdk#settings-hooks' },
            { text: '环境变量', link: '/sdk#settings-env' },
            { text: '工具权限', link: '/sdk#settings-permissions' },
            { text: '模型配置', link: '/sdk#settings-models' },
            { text: 'MCP 协议', link: '/sdk#settings-mcp' },
            { text: '记忆规则', link: '/sdk#settings-memory' },
            { text: '自定义 Skill', link: '/sdk#settings-skills' },
            { text: '子代理', link: '/sdk#settings-subagents' },
            { text: '插件配置', link: '/sdk#settings-plugins' },
          ],
        },
        {
          text: '15. 官方插件市场',
          collapsed: true,
          items: [
            { text: 'document-skills', link: '/sdk#plugin-document-skills' },
            { text: 'typescript-lsp', link: '/sdk#plugin-typescript-lsp' },
            { text: 'chrome-devtools', link: '/sdk#plugin-chrome-devtools' },
            { text: 'code2spec', link: '/sdk#plugin-code2spec' },
            { text: 'commit-skills', link: '/sdk#plugin-commit-skills' },
            { text: 'speckit', link: '/sdk#plugin-speckit' },
            { text: 'deep-wiki', link: '/sdk#plugin-deep-wiki' },
            { text: 'tavily-search', link: '/sdk#plugin-tavily-search' },
          ],
        },
        {
          text: '16. OpenTelemetry 遥测',
          collapsed: true,
          items: [
            { text: '导出器', link: '/sdk#otel-exporters' },
            { text: 'Span 体系', link: '/sdk#otel-spans' },
            { text: '事件日志', link: '/sdk#otel-events' },
            { text: 'PII 保护', link: '/sdk#otel-privacy' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/netease-lcap/wave-agent' },
    ],
  },
  head: [
    ['link', { rel: 'icon', href: 'LOGO.png' }],
  ],
}
