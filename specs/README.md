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

## Stats

| Metric | Count |
|--------|-------|
| Specs | 57 |
| User Stories | 244 |
| Functional Requirements | 930 |
| Test Files | 317 |
| Test Cases | 4,143 |

## Specs

| Feature | Description | US | FR | Links |
|---------|-------------|----|----|-------|
| File System Tools | Read, Write, Edit, Glob, Grep tools for file operations | 3 | 19 | [spec](001-fs-tools/spec.md) · [plan](001-fs-tools/plan.md) |
| Bash Tools | Bash, BashOutput, KillBash tools for shell command execution | 3 | 18 | [spec](002-bash-tools/spec.md) · [plan](002-bash-tools/plan.md) |
| MCP | Model Context Protocol support for external tools and context sources | 4 | 23 | [spec](003-mcp/spec.md) · [plan](003-mcp/plan.md) |
| Session Management | Performance-optimized, project-based session management system | 3 | 17 | [spec](004-session-management/spec.md) · [plan](004-session-management/plan.md) |
| Hooks | Event hooks system for extending Wave behavior | 16 | 62 | [spec](005-hooks/spec.md) · [plan](005-hooks/plan.md) |
| Agent Skills | Discoverable skill packages with SKILL.md files for model-invoked capabilities | 8 | 25 | [spec](006-agent-skills/spec.md) · [plan](006-agent-skills/plan.md) |
| Agent Config | Constructor-based config instead of env vars, with max output tokens and custom headers | 9 | 32 | [spec](007-agent-config/spec.md) · [plan](007-agent-config/plan.md) |
| Slash Commands | Custom slash command system for user-invoked commands | 6 | 22 | [spec](008-slash-commands/spec.md) · [plan](008-slash-commands/plan.md) |
| Subagent | Subagent support for delegating tasks to pre-configured AI personalities | 5 | 24 | [spec](009-subagent/spec.md) · [plan](009-subagent/plan.md) |
| Usage Tracking | SDK usage tracking callbacks (`onUsagesChange`) for AI calls and compression | 4 | 15 | [spec](010-usage-tracking-callback/spec.md) · [plan](010-usage-tracking-callback/plan.md) |
| Streaming | Real-time content streaming for assistant messages and tool parameters | 5 | 22 | [spec](011-stream-content-updates/spec.md) · [plan](011-stream-content-updates/plan.md) |
| AI Error Handling | Handle output token limit exceeded by prompting agent to break work into smaller pieces | 6 | 10 | [spec](012-ai-error-handling/spec.md) · [plan](012-ai-error-handling/plan.md) |
| Message Compact | Conversation history and user input size management | 6 | 23 | [spec](013-message-compact/spec.md) · [plan](013-message-compact/plan.md) |
| Image Pasting | Paste images from clipboard into chat input with placeholder and attachment | 3 | 10 | [spec](014-image-pasting/spec.md) · [plan](014-image-pasting/plan.md) |
| File Selector | Quick file/directory selector UI component | 3 | 8 | [spec](015-file-selector/spec.md) · [plan](015-file-selector/plan.md) |
| WebFetch Tool | Fetch URL content, convert HTML to markdown, process with AI model, with caching | 5 | 14 | [spec](016-web-fetch-tool/spec.md) · [plan](016-web-fetch-tool/plan.md) |
| Memory Management | Persist information across conversations via memory files | 8 | 26 | [spec](017-memory-management/spec.md) · [plan](017-memory-management/plan.md) |
| Markdown Rendering | Terminal Markdown rendering with Ink components for headings, lists, code blocks, tables | 3 | 8 | [spec](018-markdown-rendering-system/spec.md) · [plan](018-markdown-rendering-system/plan.md) |
| Prompt Cache Control | `cache_control` markers for Claude models on system messages, user messages, and tools | 4 | 7 | [spec](019-prompt-cache-control/spec.md) · [plan](019-prompt-cache-control/plan.md) |
| Prompt Engineering | Framework for prompt construction and management | 5 | 13 | [spec](020-prompt-engineering/spec.md) · [plan](020-prompt-engineering/plan.md) |
| Long Text Placeholder | Replace long pasted text in input with `[LongText#ID]` placeholder, expand on submit | 1 | 5 | [spec](021-long-text-placeholder/spec.md) · [plan](021-long-text-placeholder/plan.md) |
| Tool Permissions | Permission system with modes, wildcards, deny rules, trust, acceptEdits, dontAsk, Safe Zone | 18 | 55 | [spec](022-tool-permission-system/spec.md) · [plan](022-tool-permission-system/plan.md) |
| Built-in Subagent | Built-in subagent support for Explore agent | 2 | 10 | [spec](023-builtin-subagent/spec.md) · [plan](023-builtin-subagent/plan.md) |
| Clear Command | `/clear` command to reset conversation history and session | 2 | 6 | [spec](024-clear-command/spec.md) |
| Message Rendering | Robust message/block rendering with Ink — static history + dynamic tool executions | 3 | 8 | [spec](025-message-rendering-system/spec.md) · [plan](025-message-rendering-system/plan.md) |
| Bang Shell Command | `!` prefix to execute shell commands directly from chat input | 3 | 9 | [spec](026-bang-shell-command/spec.md) · [plan](026-bang-shell-command/plan.md) |
| Help Command | `/help` interactive help showing key bindings, built-in commands, and plugin commands | 3 | 10 | [spec](027-help-command/spec.md) · [plan](027-help-command/plan.md) |
| Status Line | Extracted StatusLine component for mode and shell command status display | 2 | 10 | [spec](028-status-line/spec.md) |
| Update Command | `wave update` / `wave-code update` to update to latest version | 2 | 7 | [spec](029-update-command/spec.md) · [plan](029-update-command/plan.md) |
| BTW Command | `/btw` for side questions bypassing the main message queue | 2 | 10 | [spec](030-btw-command/spec.md) |
| Model Command | `/model` interactive UI to switch between configured AI models | 3 | 13 | [spec](031-model-command/spec.md) |
| Confirm UI | Confirmation dialog UI components for tool permission approvals | 5 | 13 | [spec](032-confirm-ui/spec.md) · [plan](032-confirm-ui/plan.md) |
| Print Mode | Clean response-only output in `-p` mode, suppressing all subagent internals | 3 | 7 | [spec](033-print-mode/spec.md) · [plan](033-print-mode/plan.md) |
| LSP Integration | Language Server Protocol for code intelligence (definitions, references, hover) | 3 | 8 | [spec](034-lsp-integration/spec.md) · [plan](034-lsp-integration/plan.md) |
| Plugin | Plugin system with marketplace, scopes, Skills, LSP, MCP, Hooks, Agents | 6 | 28 | [spec](035-plugin/spec.md) · [plan](035-plugin/plan.md) |
| Plan Mode | Shift+Tab plan mode for read-only analysis with incremental plan file editing | 8 | 25 | [spec](036-plan-mode/spec.md) · [plan](036-plan-mode/plan.md) |
| AskUserQuestion Tool | AskUserQuestion tool for structured user interaction with options | 3 | 11 | [spec](037-ask-user-tool/spec.md) · [plan](037-ask-user-tool/plan.md) |
| Init Command | `/init` slash command using init-prompt.md for project initialization | 2 | 7 | [spec](038-init-slash-command/spec.md) · [plan](038-init-slash-command/plan.md) |
| Rewind Command | `/rewind` to revert conversation to a previous user message, reverting file changes | 3 | 10 | [spec](039-rewind-command/spec.md) · [plan](039-rewind-command/plan.md) |
| History Search | Ctrl+R history search for reusing previous prompts from `~/.wave/history.jsonl` | 2 | 10 | [spec](040-history-search-prompt/spec.md) · [plan](040-history-search-prompt/plan.md) |
| General Purpose Agent | Built-in subagent for complex research, code search, and multi-step tasks | 2 | 7 | [spec](041-general-purpose-agent/spec.md) · [plan](041-general-purpose-agent/plan.md) |
| Task Background Execution | `run_in_background`, `TaskOutput`/`TaskStop` tools, `/tasks` command replacing `/bashes` | 6 | 24 | [spec](042-task-background-execution/spec.md) · [plan](042-task-background-execution/plan.md) |
| Task Management Tools | TaskCreate/TaskGet/TaskUpdate/TaskList with `~/.wave/tasks/` storage and task list UI | 5 | 22 | [spec](043-task-management-tools/spec.md) · [plan](043-task-management-tools/plan.md) |
| Plan Subagent | Built-in Plan subagent for designing implementation plans before coding | 4 | 16 | [spec](044-plan-subagent/spec.md) · [plan](044-plan-subagent/plan.md) |
| Bash Subagent | Built-in Bash subagent for executing shell commands | 1 | 7 | [spec](045-bash-subagent/spec.md) · [plan](045-bash-subagent/plan.md) |
| Tools Selection | CLI `--tools` flag to restrict agent to a specific tool set | 4 | 8 | [spec](046-tools-selection/spec.md) · [plan](046-tools-selection/plan.md) |
| CLI Worktree | `-w/--worktree` for isolated git worktrees at `.wave/worktrees/` with safe exit | 7 | 40 | [spec](047-worktree/spec.md) · [plan](047-worktree/plan.md) |
| Status Command | `/status` showing version, session ID, cwd, model, and runtime info | 1 | 9 | [spec](048-status-command/spec.md) · [plan](048-status-command/plan.md) |
| ACP Bridge | Agent Communication Protocol bridge for connecting external clients | 5 | 17 | [spec](049-acp-bridge/spec.md) · [plan](049-acp-bridge/plan.md) |
| Builtin Settings Skill | Guide users on `settings.json`, hooks config, and Wave settings management | 3 | 8 | [spec](050-builtin-settings-skill/spec.md) · [plan](050-builtin-settings-skill/plan.md) |
| Loop Command | `/loop` for scheduling recurring prompts via cron (e.g., `/loop 5m check the build`). Includes durable persistence and multi-session scheduler lock. | 2 | 10 | [spec](051-loop-slash-command/spec.md) · [plan](051-loop-slash-command/plan.md) |
| OpenTelemetry Integration | OpenTelemetry instrumentation for metrics, traces, and logs with multiple exporters (jsonl, OTLP) | 3 | 16 | [spec](052-opentelemetry/spec.md) · [plan](052-opentelemetry/plan.md) |
| SSO Authentication | /login for browser-based SSO, token storage, auto API proxy routing | 3 | 27 | [spec](053-sso-auth/spec.md) · [plan](053-sso-auth/plan.md) |
| Custom Tools via buildTool() | buildTool() factory for SDK users to define custom tools | 3 | 11 | [spec](054-custom-tools/spec.md) · [plan](054-custom-tools/plan.md) |
| Server-Managed Config | Download and apply managed settings from Wave AI with checksum caching and merge priority | 3 | 11 | [spec](055-server-managed-config/spec.md) · [plan](055-server-managed-config/plan.md) |
| /goal Command | Autonomous multi-turn goal pursuit with fast-model evaluation and circuit breakers | 3 | 17 | [spec](056-goal-command/spec.md) · [plan](056-goal-command/plan.md) |
| Workflow — Deterministic Multi-Subagent Orchestration | Deterministic multi-subagent orchestration with pipeline, parallel, and phase control flow | 4 | 20 | [spec](057-workflow/spec.md) · [plan](057-workflow/plan.md) |
