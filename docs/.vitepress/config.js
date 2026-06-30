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
      '/sdk': [
        {
          text: '快速开始',
          collapsed: false,
          items: [
            { text: '安装', link: '/sdk#安装' },
            { text: '核心能力', link: '/sdk#核心能力' },
            { text: '基本用法', link: '/sdk#基本用法' },
            { text: '开发', link: '/sdk#开发' },
          ],
        },
        {
          text: '内置 Skills',
          collapsed: false,
          items: [
            { text: 'settings — 配置管理', link: '/sdk#skill-settings' },
            { text: 'init — 代码库初始化', link: '/sdk#skill-init' },
            { text: 'loop — 定时循环任务', link: '/sdk#skill-loop' },
          ],
        },
        {
          text: '内置 Subagents',
          collapsed: false,
          items: [
            { text: 'Bash — 命令执行', link: '/sdk#subagent-bash' },
            { text: 'Explore — 代码库探索', link: '/sdk#subagent-explore' },
            { text: 'Plan — 软件架构师', link: '/sdk#subagent-plan' },
            { text: '通用代理', link: '/sdk#subagent-general-purpose' },
          ],
        },
        {
          text: '记忆系统',
          collapsed: true,
          items: [
            { text: 'AGENTS.md 文件', link: '/sdk#agents-md' },
            { text: '消息压缩', link: '/sdk#mechanism-context-management' },
            { text: '自动记忆系统', link: '/sdk#mechanism-auto-memory' },
            { text: '记忆规则', link: '/sdk#mechanism-memory-rules' },
          ],
        },
        {
          text: 'Settings Skill',
          collapsed: false,
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
            { text: '其他设置', link: '/sdk#settings-other' },
          ],
        },
        {
          text: '官方插件市场',
          collapsed: false,
          items: [
            { text: 'document-skills', link: '/sdk#plugin-document-skills' },
            { text: 'typescript-lsp', link: '/sdk#plugin-typescript-lsp' },
            { text: 'chrome-devtools', link: '/sdk#plugin-chrome-devtools' },
            { text: 'code2spec', link: '/sdk#plugin-code2spec' },
            { text: 'code2cwspec', link: '/sdk#plugin-code2cwspec' },
            { text: 'commit-skills', link: '/sdk#plugin-commit-skills' },
            { text: 'speckit', link: '/sdk#plugin-speckit' },
            { text: 'deep-wiki', link: '/sdk#plugin-deep-wiki' },
            { text: 'tavily-search', link: '/sdk#plugin-tavily-search' },
            { text: 'lcap-extension-component', link: '/sdk#plugin-lcap-extension-component' },
            { text: 'frontend-design', link: '/sdk#plugin-frontend-design' },
          ],
        },
        {
          text: 'OpenTelemetry 遥测',
          collapsed: false,
          items: [
            { text: '导出器', link: '/sdk#otel-exporters' },
            { text: 'Span 体系', link: '/sdk#otel-spans' },
            { text: '事件日志', link: '/sdk#otel-events' },
            { text: 'PII 保护', link: '/sdk#otel-privacy' },
            { text: '可靠性保障', link: '/sdk#otel-reliability' },
          ],
        },
        {
          text: '完整工具清单',
          collapsed: true,
          items: [
            { text: 'Bash', link: '/sdk#tool-bash' },
            { text: 'Read', link: '/sdk#tool-read' },
            { text: 'Glob', link: '/sdk#tool-glob' },
            { text: 'Grep', link: '/sdk#tool-grep' },
            { text: 'Write', link: '/sdk#tool-write' },
            { text: 'Edit', link: '/sdk#tool-edit' },
            { text: 'LSP', link: '/sdk#tool-lsp' },
            { text: 'AskUserQuestion', link: '/sdk#tool-askuser' },
            { text: 'WebFetch', link: '/sdk#tool-webfetch' },
            { text: 'ToolSearch', link: '/sdk#tool-toolsearch' },
            { text: 'Worktree', link: '/sdk#tool-worktree' },
            { text: 'Cron', link: '/sdk#tool-cron' },
            { text: 'Task', link: '/sdk#tool-task' },
            { text: 'TaskStop', link: '/sdk#tool-taskstop' },
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
