# Feature Specifications

This directory contains feature specifications that serve as the source of truth for feature design and implementation.

### Standard File Layout

| File | Purpose |
|------|---------|
| `spec.md` | Feature specification — user stories, acceptance criteria, edge cases |
| `plan.md` | Implementation plan with technical approach |
| `research.md` | Research notes and findings |
| `data-model.md` | Data structures and storage format |
| `quickstart.md` | Getting started guide for the feature |
| `tasks.md` | Implementation task breakdown |
| `contracts/` | API contracts and tool interface definitions |
| `checklists/` | Safety and requirements checklists |

## Workflow

1. Write the spec (`spec.md`) with user scenarios and acceptance criteria
2. Research the approach (`research.md`)
3. Plan the implementation (`plan.md`)
4. Define data models (`data-model.md`)
5. Break down into tasks (`tasks.md`)
6. Implement against the spec

## Specs

| Feature | Description | Links |
|---------|-------------|-------|
| File System Tools | Read, Write, Edit, Glob, Grep tools for file operations | [spec](001-fs-tools/spec.md) · [plan](001-fs-tools/plan.md) |
| Bash Tools | Bash, BashOutput, KillBash tools for shell command execution | [spec](002-bash-tools/spec.md) · [plan](002-bash-tools/plan.md) |
| MCP | Model Context Protocol support for external tools and context sources | [spec](003-mcp/spec.md) · [plan](003-mcp/plan.md) |
| Session Management | Performance-optimized, project-based session management system | [spec](004-session-management/spec.md) · [plan](004-session-management/plan.md) |
| Hooks | Event hooks system for extending Wave behavior | [spec](005-hooks/spec.md) · [plan](005-hooks/plan.md) |
| Agent Skills | Discoverable skill packages with SKILL.md files for model-invoked capabilities | [spec](006-agent-skills/spec.md) · [plan](006-agent-skills/plan.md) |
| Agent Config | Constructor-based config instead of env vars, with max output tokens and custom headers | [spec](007-agent-config/spec.md) · [plan](007-agent-config/plan.md) |
| Slash Commands | Custom slash command system for user-invoked commands | [spec](008-slash-commands/spec.md) · [plan](008-slash-commands/plan.md) |
| Subagent | Subagent support for delegating tasks to pre-configured AI personalities | [spec](009-subagent/spec.md) · [plan](009-subagent/plan.md) |
| Usage Tracking | SDK usage tracking callbacks (`onUsagesChange`) for AI calls and compression | [spec](010-usage-tracking-callback/spec.md) · [plan](010-usage-tracking-callback/plan.md) |
| Streaming | Real-time content streaming for assistant messages and tool parameters | [spec](012-stream-content-updates/spec.md) · [plan](012-stream-content-updates/plan.md) |
| AI Error Handling | Handle output token limit exceeded by prompting agent to break work into smaller pieces | [spec](013-ai-error-handling/spec.md) · [plan](013-ai-error-handling/plan.md) |
| Message Compression | Conversation history and user input size management | [spec](014-message-compression/spec.md) · [plan](014-message-compression/plan.md) |
| Image Pasting | Paste images from clipboard into chat input with placeholder and attachment | [spec](015-image-pasting/spec.md) · [plan](015-image-pasting/plan.md) |
| File Selector | Quick file/directory selector UI component | [spec](016-file-selector/spec.md) · [plan](016-file-selector/plan.md) |
| WebFetch Tool | Fetch URL content, convert HTML to markdown, process with AI model, with caching | [spec](017-web-fetch-tool/spec.md) · [plan](017-web-fetch-tool/plan.md) |
| Memory Management | Persist information across conversations via memory files | [spec](018-memory-management/spec.md) · [plan](018-memory-management/plan.md) |
| Markdown Rendering | Terminal Markdown rendering with Ink components for headings, lists, code blocks, tables | [spec](020-markdown-rendering-system/spec.md) · [plan](020-markdown-rendering-system/plan.md) |
| Prompt Cache Control | `cache_control` markers for Claude models on system messages, user messages, and tools | [spec](021-prompt-cache-control/spec.md) · [plan](021-prompt-cache-control/plan.md) |
| Prompt Engineering | Framework for prompt construction and management | [spec](022-prompt-engineering/spec.md) · [plan](022-prompt-engineering/plan.md) |
| Long Text Placeholder | Replace long pasted text in input with `[LongText#ID]` placeholder, expand on submit | [spec](023-long-text-placeholder/spec.md) · [plan](023-long-text-placeholder/plan.md) |
| Tool Permissions | Permission system with modes, wildcards, deny rules, trust, acceptEdits, dontAsk, Safe Zone | [spec](024-tool-permission-system/spec.md) · [plan](024-tool-permission-system/plan.md) |
| Built-in Subagent | Built-in subagent support for Explore agent | [spec](025-builtin-subagent/spec.md) · [plan](025-builtin-subagent/plan.md) |
| Clear Command | `/clear` command to reset conversation history and session | [spec](026-clear-command/spec.md) |
| Message Rendering | Robust message/block rendering with Ink — static history + dynamic tool executions | [spec](027-message-rendering-system/spec.md) · [plan](027-message-rendering-system/plan.md) |
| Bang Shell Command | `!` prefix to execute shell commands directly from chat input | [spec](028-bang-shell-command/spec.md) · [plan](028-bang-shell-command/plan.md) |
| Help Command | `/help` interactive help showing key bindings, built-in commands, and plugin commands | [spec](029-help-command/spec.md) · [plan](029-help-command/plan.md) |
| Status Line | Extracted StatusLine component for mode and shell command status display | [spec](030-status-line/spec.md) |
| Update Command | `wave update` / `wave-code update` to update to latest version | [spec](031-update-command/spec.md) · [plan](031-update-command/plan.md) |
| BTW Command | `/btw` for side questions bypassing the main message queue | [spec](032-btw-command/spec.md) |
| Model Command | `/model` interactive UI to switch between configured AI models | [spec](033-model-command/spec.md) |
| Confirm UI | Confirmation dialog UI components for tool permission approvals | [spec](034-confirm-ui/spec.md) · [plan](034-confirm-ui/plan.md) |
| LSP Integration | Language Server Protocol for code intelligence (definitions, references, hover) | [spec](039-lsp-integration/spec.md) · [plan](039-lsp-integration/plan.md) |
| Plugin | Plugin system with marketplace, scopes, Skills, LSP, MCP, Hooks, Agents | [spec](042-plugin/spec.md) · [plan](042-plugin/plan.md) |
| Plan Mode | Shift+Tab plan mode for read-only analysis with incremental plan file editing | [spec](050-plan-mode/spec.md) · [plan](050-plan-mode/plan.md) |
| AskUserQuestion Tool | AskUserQuestion tool for structured user interaction with options | [spec](052-ask-user-tool/spec.md) · [plan](052-ask-user-tool/plan.md) |
| Init Command | `/init` slash command using init-prompt.md for project initialization | [spec](054-init-slash-command/spec.md) · [plan](054-init-slash-command/plan.md) |
| Rewind Command | `/rewind` to revert conversation to a previous user message, reverting file changes | [spec](056-rewind-command/spec.md) · [plan](056-rewind-command/plan.md) · [tasks](056-rewind-command/tasks.md) |
| History Search | Ctrl+R history search for reusing previous prompts from `~/.wave/history.jsonl` | [spec](057-history-search-prompt/spec.md) · [plan](057-history-search-prompt/plan.md) · [tasks](057-history-search-prompt/tasks.md) |
| General Purpose Agent | Built-in subagent for complex research, code search, and multi-step tasks | [spec](058-general-purpose-agent/spec.md) · [plan](058-general-purpose-agent/plan.md) · [tasks](058-general-purpose-agent/tasks.md) |
| Task Background Execution | `run_in_background`, `TaskOutput`/`TaskStop` tools, `/tasks` command replacing `/bashes` | [spec](061-task-background-execution/spec.md) · [plan](061-task-background-execution/plan.md) · [tasks](061-task-background-execution/tasks.md) |
| Task Management Tools | TaskCreate/TaskGet/TaskUpdate/TaskList with `~/.wave/tasks/` storage and task list UI | [spec](063-task-management-tools/spec.md) · [plan](063-task-management-tools/plan.md) · [tasks](063-task-management-tools/tasks.md) |
| Plan Subagent | Built-in Plan subagent for designing implementation plans before coding | [spec](065-plan-subagent/spec.md) · [plan](065-plan-subagent/plan.md) · [tasks](065-plan-subagent/tasks.md) |
| Bash Subagent | Built-in Bash subagent for executing shell commands | [spec](066-bash-subagent/spec.md) · [plan](066-bash-subagent/plan.md) · [tasks](066-bash-subagent/tasks.md) |
| Tools Selection | CLI `--tools` flag to restrict agent to a specific tool set | [spec](067-tools-selection/spec.md) · [plan](067-tools-selection/plan.md) · [tasks](067-tools-selection/tasks.md) |
| CLI Worktree | `-w/--worktree` for isolated git worktrees at `.wave/worktrees/` with safe exit | [spec](068-cli-worktree/spec.md) · [plan](068-cli-worktree/plan.md) · [tasks](068-cli-worktree/tasks.md) |
| Status Command | `/status` showing version, session ID, cwd, model, and runtime info | [spec](069-status-command/spec.md) · [plan](069-status-command/plan.md) · [tasks](069-status-command/tasks.md) |
| ACP Bridge | Agent Communication Protocol bridge for connecting external clients | [spec](070-acp-bridge/spec.md) · [plan](070-acp-bridge/plan.md) · [tasks](070-acp-bridge/tasks.md) |
| Builtin Settings Skill | Guide users on `settings.json`, hooks config, and Wave settings management | [spec](071-builtin-settings-skill/spec.md) · [plan](071-builtin-settings-skill/plan.md) · [tasks](071-builtin-settings-skill/tasks.md) |
| Loop Command | `/loop` for scheduling recurring prompts via cron (e.g., `/loop 5m check the build`) | [spec](072-loop-slash-command/spec.md) · [plan](072-loop-slash-command/plan.md) · [tasks](072-loop-slash-command/tasks.md) |
| Deferred Tool Loading | `shouldDefer` flag for on-demand tool loading via ToolSearch discovery | [spec](074-should-defer-tool-loading/spec.md) · [plan](074-should-defer-tool-loading/plan.md) · [tasks](074-should-defer-tool-loading/tasks.md) |
