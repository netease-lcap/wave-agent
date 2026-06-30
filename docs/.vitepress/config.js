export default {
  base: '/wave-agent/',
  title: 'Wave Agent',
  description: 'AI 辅助编程工具链 — SDK、CLI 与 VS Code 扩展',
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: 'VS Code 扩展', link: '/vsce' },
      { text: 'SDK', link: '/sdk' },
      { text: 'CLI', link: '/cli' },
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
            {
              text: '6.4 内置 Skills',
              collapsed: false,
              items: [
                { text: 'settings — 配置管理', link: '/vsce#skill-settings' },
                { text: 'init — 代码库初始化', link: '/vsce#skill-init' },
                { text: 'loop — 定时循环任务', link: '/vsce#skill-loop' },
              ],
            },
            {
              text: '6.5 内置 Subagents',
              collapsed: false,
              items: [
                { text: 'Bash — 命令执行', link: '/vsce#subagent-bash' },
                { text: 'Explore — 代码库探索', link: '/vsce#subagent-explore' },
                { text: 'Plan — 软件架构师', link: '/vsce#subagent-plan' },
                { text: '通用代理', link: '/vsce#subagent-general-purpose' },
              ],
            },
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
          text: '9. 记忆系统',
          collapsed: true,
          items: [
            { text: '9.1 AGENTS.md 文件', link: '/vsce#agents-md' },
            { text: '9.2 消息压缩', link: '/vsce#mechanism-context-management' },
            { text: '9.3 自动记忆系统', link: '/vsce#mechanism-auto-memory' },
            { text: '9.4 记忆规则', link: '/vsce#mechanism-memory-rules' },
          ],
        },
        {
          text: '10. 配置管理',
          collapsed: false,
          items: [
            { text: '10.1 配置设置', link: '/vsce#configuration-settings' },
            { text: '10.2 语言设置', link: '/vsce#language-settings' },
            {
              text: '10.3 Settings Skill',
              collapsed: false,
              items: [
                { text: 'settings.json 配置中心', link: '/vsce#settings-json' },
                { text: '钩子 (Hooks)', link: '/vsce#settings-hooks' },
                { text: '环境变量', link: '/vsce#settings-env' },
                { text: '工具权限', link: '/vsce#settings-permissions' },
                { text: '模型配置', link: '/vsce#settings-models' },
                { text: 'MCP 协议', link: '/vsce#settings-mcp' },
                { text: '记忆规则', link: '/vsce#settings-memory' },
                { text: '自定义 Skill', link: '/vsce#settings-skills' },
                { text: '子代理', link: '/vsce#settings-subagents' },
                { text: '插件配置', link: '/vsce#settings-plugins' },
                { text: '其他设置', link: '/vsce#settings-other' },
              ],
            },
          ],
        },
        {
          text: '11. 插件系统',
          collapsed: false,
          items: [
            { text: '11.1 概述', link: '/vsce#plugin-overview' },
            { text: '11.2 探索新插件', link: '/vsce#explore-plugins' },
            { text: '11.3 已激活插件', link: '/vsce#installed-plugins' },
            {
              text: '11.4 官方插件市场',
              collapsed: false,
              items: [
                { text: 'document-skills', link: '/vsce#plugin-document-skills' },
                { text: 'typescript-lsp', link: '/vsce#plugin-typescript-lsp' },
                { text: 'chrome-devtools', link: '/vsce#plugin-chrome-devtools' },
                { text: 'code2spec', link: '/vsce#plugin-code2spec' },
                { text: 'code2cwspec', link: '/vsce#plugin-code2cwspec' },
                { text: 'commit-skills', link: '/vsce#plugin-commit-skills' },
                { text: 'speckit', link: '/vsce#plugin-speckit' },
                { text: 'deep-wiki', link: '/vsce#plugin-deep-wiki' },
                { text: 'tavily-search', link: '/vsce#plugin-tavily-search' },
                { text: 'lcap-extension-component', link: '/vsce#plugin-lcap-extension-component' },
                { text: 'frontend-design', link: '/vsce#plugin-frontend-design' },
              ],
            },
          ],
        },
        {
          text: '12. OpenTelemetry 遥测',
          collapsed: false,
          items: [
            { text: '12.1 导出器', link: '/vsce#otel-exporters' },
            { text: '12.2 Span 体系', link: '/vsce#otel-spans' },
            { text: '12.3 事件日志', link: '/vsce#otel-events' },
            { text: '12.4 PII 保护', link: '/vsce#otel-privacy' },
            { text: '12.5 可靠性保障', link: '/vsce#otel-reliability' },
          ],
        },
        {
          text: '13. 完整工具清单',
          collapsed: true,
          items: [
            { text: '13.1 Bash', link: '/vsce#tool-bash' },
            { text: '13.2 Read', link: '/vsce#tool-read' },
            { text: '13.3 Glob', link: '/vsce#tool-glob' },
            { text: '13.4 Grep', link: '/vsce#tool-grep' },
            { text: '13.5 Write', link: '/vsce#tool-write' },
            { text: '13.6 Edit', link: '/vsce#tool-edit' },
            { text: '13.7 LSP', link: '/vsce#tool-lsp' },
            { text: '13.8 AskUserQuestion', link: '/vsce#tool-askuser' },
            { text: '13.9 WebFetch', link: '/vsce#tool-webfetch' },
            { text: '13.10 ToolSearch', link: '/vsce#tool-toolsearch' },
            { text: '13.11 Worktree', link: '/vsce#tool-worktree' },
            { text: '13.12 Cron', link: '/vsce#tool-cron' },
            { text: '13.13 Task', link: '/vsce#tool-task' },
            { text: '13.14 TaskStop', link: '/vsce#tool-taskstop' },
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
