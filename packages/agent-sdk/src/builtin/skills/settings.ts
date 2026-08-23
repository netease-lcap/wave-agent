export const settingsSkills: Record<string, string> = {
  "skills/settings/ENV.md": `# Wave Environment Variables Configuration

Environment variables allow you to customize Wave's behavior, configure AI models, and provide context to hooks and tools. This document provides detailed guidance on how to configure environment variables in \`settings.json\`.

## The \`env\` Field

Environment variables are configured in the \`env\` field of \`settings.json\`. It is a simple key-value pair of strings.

\`\`\`json
{
  "env": {
    "WAVE_MODEL": "gemini-3-flash",
    "MY_CUSTOM_VAR": "some-value"
  }
}
\`\`\`

## Supported \`WAVE_*\` Environment Variables

Wave uses several environment variables to control its core functionality. Variables marked **OS env only** are read from the OS environment (or constructor / stdio \`initialize\` params) and are **NOT** read from settings.json \`env\` — set them in your shell, not in the \`env\` field.

| Variable | Description | Default |
| :--- | :--- | :--- |
| \`WAVE_API_KEY\` | API key for the AI gateway. | - |
| \`WAVE_BASE_URL\` | Base URL for the AI gateway. | - |
| \`WAVE_SERVER_URL\` | Server URL for SSO authentication. Resolution order: \`options.serverUrl\` → \`process.env.WAVE_SERVER_URL\` → default. Unlike other \`WAVE_*\` vars, a settings.json \`env\` value is also mirrored to \`process.env\` so process-level singletons (AuthService) see it without a per-session snapshot. | \`https://codechat.codewave.163.com\` |
| \`WAVE_CUSTOM_HEADERS\` | Custom HTTP headers for the AI gateway. Newline-separated \`Key: Value\` pairs (e.g., \`"X-Foo: bar\\nAuthorization: Bearer xxx"\`). | - |
| \`WAVE_MODEL\` | The primary AI model to use for the agent. | \`gemini-3-flash\` |
| \`WAVE_FAST_MODEL\` | The fast AI model to use for quick tasks. | \`gemini-2.5-flash\` |
| \`WAVE_VISION_MODEL\` | Vision-capable model used by the built-in \`vision\` subagent for image recognition. When set, the built-in \`vision\` subagent is registered (its frontmatter \`model: visionModel\` resolves to this value); when unset, the subagent is not loaded. Useful when the main model is fast but non-vision (e.g. DeepSeek). | - (not registered) |
| \`WAVE_MAX_INPUT_TOKENS\` | Maximum number of input tokens allowed. Overridden per-model by \`models[<model>].maxInputTokens\`. | \`200000\` |
| \`WAVE_MAX_OUTPUT_TOKENS\` | Maximum number of output tokens allowed. | \`32000\` |
| \`WAVE_DISABLE_AUTO_MEMORY\` | Set to \`1\` or \`true\` to disable the auto-memory feature. | \`false\` |
| \`WAVE_AUTO_MEMORY_FREQUENCY\` | Auto memory update frequency. \`1\` = every turn, \`2\` = every 2 turns, etc. | \`1\` |
| \`WAVE_TASK_LIST_ID\` | Explicitly set the task list ID for the session. | (Session ID) |
| \`WAVE_PLUGIN_GIT_TIMEOUT_MS\` | Timeout in milliseconds for git operations when installing plugins. **OS env only** (infrastructure). | \`300000\` |

## Configuration Scopes

Environment variables can be set in different scopes. Wave merges scopes from lowest to highest priority and stores the result in the agent's **per-session environment snapshot**. The snapshot takes priority over OS environment variables but is **NOT written to \`process.env\`** — this keeps multiple sessions in one \`wave --stdio\` process from polluting each other.

Precedence (highest to lowest):

1.  **Local Scope**: \`.wave/settings.local.json\` (Local overrides, ignored by git)
2.  **Project Scope**: \`.wave/settings.json\` (Project-specific settings, shared via git)
3.  **User Scope**: \`~/.wave/settings.json\` (Global settings for all projects)
4.  **System Environment**: Variables set in your shell (e.g., \`export WAVE_API_KEY=...\`). Used as a fallback when a key is absent from the settings snapshot.

> Settings \`env\` shadows (does not mutate) OS env: a key set in both settings.json \`env\` and the OS environment resolves to the settings value for that session, while the OS value remains untouched and visible to unrelated processes.

## Custom Environment Variables

You can also define custom environment variables in the \`env\` field. These variables are stored in the session's environment snapshot and will be available to:

- **Hooks**: Any shell command executed as a hook will have these variables in its environment (merged on top of OS env).
- **Tools**: Tools like \`Bash\` will have access to these variables (merged on top of OS env).

In \`wave --stdio\` mode one process hosts multiple sessions; each session keeps its own snapshot, so sessions with different \`env\` do not pollute each other (no "last session wins").

Example:
\`\`\`json
{
  "env": {
    "PROJECT_NAME": "my-awesome-project",
    "DEPLOY_TARGET": "staging"
  }
}
\`\`\`

## Live Reload

Environment variables configured in \`settings.json\` support **live reload**. When you modify the \`env\` field in any \`settings.json\` file (user, project, or local scope), the changes take effect immediately without requiring a Wave session restart — the session's environment snapshot is refreshed and subsequent resolve calls / subprocess spawns use the new values.

## Best Practices

- **Use Local Overrides for Secrets**: Never commit sensitive information like \`WAVE_API_KEY\` to \`settings.json\`. Use \`settings.local.json\` instead.
- **Standard Naming**: Use uppercase and underscores for environment variable names (e.g., \`MY_VARIABLE\`).
- **Avoid Overriding System Variables**: Be careful not to override standard system variables like \`PATH\` or \`HOME\` unless you have a specific reason to do so.
`,
  "skills/settings/HOOKS.md": `# Wave Hooks Configuration

Hooks allow you to automate tasks when certain events occur in Wave. This document provides detailed guidance on how to configure hooks in \`settings.json\`.

## Hook Events

Wave supports the following hook events:

- \`PreToolUse\`: Triggered before a tool is executed.
- \`PostToolUse\`: Triggered after a tool has finished executing.
- \`UserPromptSubmit\`: Triggered when a user submits a prompt.
- \`PermissionRequest\`: Triggered when Wave requests permission to use a tool.
- \`Stop\`: Triggered when Wave finishes its response cycle (no more tool calls).
- \`SubagentStop\`: Triggered when a subagent finishes its response cycle.
- \`WorktreeCreate\`: Triggered to create a new worktree, replacing \`git worktree add\`. The hook performs the creation itself (e.g., \`git worktree add\`, or any other VCS/external provisioning) and must output the worktree's absolute path on stdout (path return). Creation is blocked if all hooks fail or produce no output. Receives \`name\` in the JSON input. The resulting session is marked "hook-based".
- \`WorktreeRemove\`: Triggered when a hook-based worktree (created by a \`WorktreeCreate\` hook) is removed (e.g., via ExitWorktree with \`action: "remove"\`), replacing \`git worktree remove\` for that worktree: the hook performs the removal itself (e.g., \`git worktree remove --force\` plus external resource cleanup). Fires **before** the worktree directory is deleted so hooks can still read files inside it. Receives \`worktree_path\` in the JSON input. Failures are logged but non-blocking. Git-created worktrees are removed by git directly and do not trigger this hook.
- \`CwdChanged\`: Triggered when the working directory changes (e.g., entering/exiting a worktree). Non-blocking.
- \`SessionStart\`: Triggered during session initialization. Hooks can inject \`additionalContext\` and \`initialUserMessage\` via stdout.
- \`SessionEnd\`: Triggered during agent destruction (fire-and-forget, non-blocking). Useful for cleanup, resource teardown, and analytics.
- \`PreCompact\`: Triggered before conversation compaction. Hook stdout is captured as additional instructions and merged into the compaction prompt.
- \`PostCompact\`: Triggered after conversation compaction completes. Receives the compact summary text.

## Hook Configuration Structure

Hooks are configured in the \`hooks\` field of \`settings.json\`. Each event can have multiple hook configurations.

\`\`\`json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "command": "pnpm lint",
            "description": "Run lint before writing files"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "command": "echo \\"Permission requested for Bash tool\\" >> hooks.log",
            "description": "Log permission requests for Bash"
          }
        ]
      }
    ]
  }
}
\`\`\`

## Hook Configuration Fields

- \`matcher\`: (Optional) A pattern to match against the tool name (e.g., "Write", "Read*", "/^Edit/"). Only applicable for \`PreToolUse\`, \`PostToolUse\`, and \`PermissionRequest\`.
- \`hooks\`: An array of hook commands to execute.
  - \`command\`: The shell command to execute.
  - \`description\`: A brief description of the hook's purpose.
  - \`async\`: (Optional) Whether the hook should run in the background without blocking (default: \`false\`).
  - \`timeout\`: (Optional) Maximum execution time in seconds (default: \`600\`).

## Hook Input JSON

Wave provides detailed context to hook processes via \`stdin\` as a JSON object. This allows hooks to make informed decisions based on the current state.

### Common Fields
- \`session_id\`: The current session ID.
- \`transcript_path\`: Path to the session transcript file (JSON).
- \`cwd\`: The current working directory.
- \`hook_event_name\`: The name of the triggering event.

### Event-Specific Fields
- \`tool_name\`: (PreToolUse, PostToolUse, PermissionRequest) The name of the tool.
- \`tool_input\`: (PreToolUse, PostToolUse, PermissionRequest) The input parameters passed to the tool.
- \`tool_response\`: (PostToolUse) The result of the tool execution.
- \`user_prompt\`: (UserPromptSubmit) The text submitted by the user.
- \`subagent_type\`: (If executed by a subagent) The type of the subagent.
- \`name\`: (WorktreeCreate) The name of the new worktree.
- \`worktree_path\`: (WorktreeRemove) The absolute path of the worktree about to be removed. Derive the worktree name with \`basename "$worktree_path"\`.
- \`old_cwd\`: (CwdChanged) The previous working directory.
- \`new_cwd\`: (CwdChanged) The new working directory.
- \`compact_instructions\`: (PreCompact) Custom instructions for the compaction, if any.
- \`compact_summary\`: (PostCompact) The AI-generated compaction summary text.
- \`background_tasks\`: (Stop) Snapshot of running background tasks (array of \`{id, type: "shell"|"subagent"|"workflow", status, description, command?, startedAt}\`).
- \`session_crons\`: (Stop) Snapshot of session-scoped cron jobs (array of \`{name, schedule, prompt}\`).
- \`last_assistant_message\`: (Stop, SubagentStop) Text content of the last assistant message.
- \`plan_file_path\`: (Present when in plan mode) Path to the active plan file.
- \`source\`: (SessionStart) The session start source: \`"startup"\`, \`"resume"\`, \`"compact"\`, or \`"clear"\`.
- \`agent_type\`: (SessionStart) The agent type identifier.
- \`end_source\`: (SessionEnd) The session end source: \`"exit"\`, \`"resume"\`, \`"stop"\`, \`"compact"\`, or \`"clear"\`.

## Hook Exit Codes

Hooks can communicate status and control Wave's behavior using exit codes:

- **Exit 0**: Success. Wave continues its normal execution.
- **Exit 2**: Blocking Error. Wave blocks the current operation and provides feedback based on the event:
    - \`UserPromptSubmit\`: Blocks prompt processing and shows \`stderr\` as a user error.
    - \`PreToolUse\`: Blocks tool execution and provides \`stderr\` to the agent as feedback.
    - \`PostToolUse\`: Appends \`stderr\` to the tool result as feedback for the agent.
    - \`Stop\`: Blocks the stop operation and provides \`stderr\` to the agent.
    - \`WorktreeCreate\` / \`WorktreeRemove\` / \`CwdChanged\` / \`PreCompact\` / \`PostCompact\`: Shows \`stderr\` in an error block, but does not block the operation.
    - \`SessionStart\` / \`SessionEnd\`: Shows \`stderr\` in an error block, but does not block startup or shutdown.
- **Other Exits (e.g., Exit 1)**: Non-blocking error. Wave continues execution but shows \`stderr\` as a warning to the user.

## SessionStart Hooks

\`SessionStart\` hooks fire during session initialization. They can inject context and messages into the session via stdout.

### Stdout Processing

Hook stdout is processed as follows:
- If stdout is valid JSON with \`hookSpecificOutput.additionalContext\` (Claude Code format), that value is injected as additional context.
- If stdout is valid JSON with \`initialUserMessage\` at the top level, that value is injected as the initial user message.
- If stdout is not JSON, the entire output is appended as additional context.

Example hook output:
\`\`\`json
{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "User prefers concise responses"}, "initialUserMessage": "Here is my current task..."}
\`\`\`

### Example Configuration
\`\`\`json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "command": "echo '{\\"hookSpecificOutput\\": {\\"hookEventName\\": \\"SessionStart\\", \\"additionalContext\\": \\"Project uses pnpm and TypeScript\\"}}'",
            "description": "Inject project context at session start"
          }
        ]
      }
    ]
  }
}
\`\`\`

## SessionEnd Hooks

\`SessionEnd\` hooks fire during agent destruction (fire-and-forget, non-blocking). They are useful for cleanup tasks, resource teardown, and analytics.

### Input
SessionEnd hooks receive \`end_source\` in the JSON input indicating how the session ended:
- \`"exit"\`: User exited the session
- \`"stop"\`: Session was explicitly stopped
- \`"compact"\`: Session was compacted

### Example Configuration
\`\`\`json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "command": "echo '{\\"session_id\\": \\"$WAVE_SESSION_ID\\"}' >> /tmp/session-analytics.log",
            "description": "Log session end for analytics",
            "async": true
          }
        ]
      }
    ]
  }
}
\`\`\`

## WorktreeCreate Hooks

\`WorktreeCreate\` hooks replace \`git worktree add\`: when configured, Wave does not create the worktree itself — the hook does. The hook must output the worktree's absolute path on **stdout** (the first successful hook's trimmed stdout is used as the path). All hooks failing or producing no output blocks the creation with \`WorktreeCreate hook failed: ...\`. The resulting session is marked "hook-based" and skips Wave's post-creation setup (\`settings.local.json\` / \`.worktreeinclude\` propagation) — the hook is responsible for any initialization.

### Input
WorktreeCreate hooks receive \`name\` (the worktree name) in the JSON input, alongside the common fields \`session_id\`, \`transcript_path\`, \`cwd\`, \`hook_event_name\`.

### Example Configuration
\`\`\`json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "command": "worktree_path=\\"$WAVE_PROJECT_DIR/.wave/worktrees/$(jq -r '.name')\\" && mkdir -p \\"$worktree_path\\" && git worktree add \\"$worktree_path\\" 2>/dev/null; echo \\"$worktree_path\\"",
            "description": "Create the worktree and print its path"
          }
        ]
      }
    ]
  }
}
\`\`\`

## WorktreeRemove Hooks

\`WorktreeRemove\` hooks replace \`git worktree remove\` for **hook-based** worktrees (those created by a \`WorktreeCreate\` hook). When a hook-based worktree is removed from any entry point (CLI exit, ExitWorktree tool, \`wave -p\`, stdio RPC), Wave calls the hook instead of running \`git worktree remove\` — the hook performs the actual removal, so it can clean up external resources it provisioned (databases, containers, etc.) at the same time. Hooks fire **before** the worktree directory is deleted, so they can still read files inside it. Failures are logged but non-blocking. If no \`WorktreeRemove\` hook is configured for a hook-based worktree, Wave logs a warning and leaves the worktree in place. Git-created worktrees (no \`WorktreeCreate\` hook) are removed by git directly and do **not** trigger this hook.

### Input
WorktreeRemove hooks receive \`worktree_path\` in the JSON input (alongside the common fields \`session_id\`, \`transcript_path\`, \`cwd\`, \`hook_event_name\`). The worktree name can be derived via \`basename "$worktree_path"\`.

### Example Configuration
\`\`\`json
{
  "hooks": {
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "command": "worktree_path=$(jq -r '.worktree_path') && git worktree remove --force \\"$worktree_path\\" && docker compose -p \\"$(basename \\"$worktree_path\\")\\" down",
            "description": "Remove the worktree and tear down its docker compose project"
          }
        ]
      }
    ]
  }
}
\`\`\`

## Live Reload

Hook configurations support **live reload**. When you modify hooks in \`settings.json\`, the changes take effect immediately without restarting Wave.

## Plugin Hooks

When hooks are registered via a **plugin**, Wave automatically:

1. Substitutes \`\${WAVE_PLUGIN_ROOT}\` with the plugin's directory path in the command string
2. Injects \`WAVE_PLUGIN_ROOT\` as an environment variable into the hook process

\`\`\`json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "command": "\${WAVE_PLUGIN_ROOT}/scripts/setup-worktree.sh"
          }
        ]
      }
    ]
  }
}
\`\`\`

The shell also receives \`WAVE_PLUGIN_ROOT\` as an env var, so \`$WAVE_PLUGIN_ROOT\` works in the hook script itself. For \`WorktreeCreate\`, the script must print the created worktree's absolute path to stdout.

## Best Practices

- **Keep hooks fast**: Long-running hooks can slow down your workflow unless they are \`async\`.
- **Use descriptive names**: Help yourself and others understand what each hook does.
- **Test your hooks**: Run the commands manually first to ensure they work as expected.
- **Use local overrides**: For machine-specific hooks, use \`.wave/settings.local.json\`.
`,
  "skills/settings/MCP.md": `# Model Context Protocol (MCP) Configuration

The Model Context Protocol (MCP) allows Wave to connect to external servers that provide additional tools and context. This document explains how to configure and use MCP servers in Wave.

## Configuration File: \`.mcp.json\`

MCP servers are configured in a \`.mcp.json\` file. Wave looks for this file in your project root:

1.  **Project Scope**: \`.mcp.json\` in your project root (Project-specific MCP servers)

## Configuration Structure

The \`.mcp.json\` file contains a list of MCP server configurations.

\`\`\`json
{
  "mcpServers": {
    "sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "/path/to/your/database.db"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
\`\`\`

### Fields for each server:

- \`type\`: (Optional) The transport type: \`"stdio"\`, \`"sse"\`, or \`"http"\`. If omitted, Wave infers the type from other fields (URL → \`"http"\`, command → \`"stdio"\`). Set explicitly for clarity and to avoid the default behavior.
- \`command\`: (For stdio) The executable to run (e.g., \`npx\`, \`uvx\`, \`python\`, \`node\`).
- \`args\`: (For stdio) An array of command-line arguments for the executable.
- \`env\`: (Optional) A record of environment variables for the server process.
- \`url\`: (For \`sse\`/\`http\`) The endpoint URL of a remote MCP server.
- \`headers\`: (For \`sse\`/\`http\`) A record of HTTP headers to send with requests (e.g., \`{"Authorization": "Bearer token"}\`).

## Transport Types

Wave supports three MCP transport types. When \`type\` is not specified, Wave uses the following defaults:
- If \`url\` is provided → defaults to \`"http"\` (Streamable HTTP)
- If \`command\` is provided → defaults to \`"stdio"\`

### stdio

The server is launched as a local subprocess. Use for locally installed MCP servers.

\`\`\`json
{
  "mcpServers": {
    "sqlite": {
      "type": "stdio",
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "/path/to/db"]
    }
  }
}
\`\`\`

### http (Streamable HTTP)

The recommended transport for remote servers. Uses the MCP Streamable HTTP protocol.

\`\`\`json
{
  "mcpServers": {
    "remote-api": {
      "type": "http",
      "url": "https://mcp-server.example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  }
}
\`\`\`

### sse (Server-Sent Events)

Legacy transport for remote servers that only support SSE. Use \`"http"\` for new servers unless the server requires SSE.

\`\`\`json
{
  "mcpServers": {
    "legacy-server": {
      "type": "sse",
      "url": "https://mcp-server.example.com/sse"
    }
  }
}
\`\`\`

> **Note**: When \`type\` is not specified, URL-based servers default to \`"http"\` with no SSE fallback. If you need SSE, set \`type: "sse"\` explicitly.

## Using MCP Tools

Once configured, Wave will automatically connect to the MCP servers when it starts. Tools provided by these servers will be available to the agent with a prefix:

\`mcp__[serverName]__[toolName]\`

For example, if you have a server named \`sqlite\` with a tool named \`query\`, it will be available as \`mcp__sqlite__query\`.

## Permissions for MCP Tools

By default, MCP tools require user permission before execution. When you grant permission, you can choose to "Allow always" for a specific tool. These persistent rules are stored in your \`settings.json\` under the \`permissions\` field.

## Plugin MCP Servers

When MCP servers are registered via a **plugin**, Wave automatically injects the \`WAVE_PLUGIN_ROOT\` environment variable into the server process. Additionally, \`\${WAVE_PLUGIN_ROOT}\` in the \`command\`, \`args\`, and \`env\` fields is substituted with the plugin's directory path before the server is spawned (matching Claude Code's \`\${CLAUDE_PLUGIN_ROOT}\` behavior).

\`\`\`json
{
  "mcpServers": {
    "my-plugin-server": {
      "command": "\${WAVE_PLUGIN_ROOT}/bin/mcp-server",
      "args": ["--config", "\${WAVE_PLUGIN_ROOT}/config/server.json"]
    }
  }
}
\`\`\`

Your MCP server code can also read \`WAVE_PLUGIN_ROOT\` as an environment variable:

\`\`\`ts
// Inside your MCP server (e.g., a Node.js script)
const pluginRoot = process.env.WAVE_PLUGIN_ROOT;
\`\`\`

## Troubleshooting

- **Server Connection**: If a server fails to connect, Wave will log an error. You can check the status of MCP servers by asking the agent.
- **Tool Availability**: If a tool is not appearing, ensure the server is running and the \`.mcp.json\` configuration is correct.
- **Logs**: MCP server \`stderr\` is often used for logging and can be helpful for debugging connection issues.
`,
  "skills/settings/MEMORY.md": `# Wave Memory

Wave provides multiple memory layers to give the agent context-specific instructions and knowledge. Memory files are standard Markdown files loaded automatically at startup.

## Memory Layers

Wave looks for memory in the following locations, loaded in order of increasing priority:

1. **User Memory**: \`~/.wave/AGENTS.md\` — Global instructions across all projects
2. **Project Memory**: \`AGENTS.md\` in the project root — Project-specific instructions
3. **Memory Rules**: \`.wave/rules/*.md\` and \`~/.wave/rules/*.md\` — Modular, path-scoped rules (see below)

> \`CLAUDE.md\` is also supported as a fallback for both user and project memory, for compatibility with existing repositories.

## User Memory

Stored at \`~/.wave/AGENTS.md\`. Use it for cross-project preferences and global instructions, e.g. "always write tests for new features", "prefer functional style".

## Project Memory

### Project Memory File

The \`AGENTS.md\` file in the project root is the primary project-level memory. It is checked into the repository and shared with all contributors. Use it for:

- Build and test commands (e.g. "use pnpm not npm")
- Project structure and architecture conventions
- Coding standards and patterns

### Memory Rules

Memory rules are modular Markdown files that provide path-scoped instructions. They are discovered in:

- **Project scope**: \`.wave/rules/*.md\` (checked into the repo)
- **User scope**: \`~/.wave/rules/*.md\` (personal, not shared)

Each file can optionally include YAML frontmatter to scope rules to specific file paths:

\`\`\`markdown
---
paths:
  - "src/api/**/*.ts"
  - "src/services/**/*.ts"
---

# API and Service Guidelines

- Always use \`async/await\` for asynchronous operations.
- Use \`Zod\` for input validation.
\`\`\`

#### YAML Frontmatter Fields

- \`paths\`: (Optional) A list of glob patterns. The rules in this file will only be active when the agent is working with files that match these patterns. If omitted, the rules are always active.
- \`priority\`: (Optional) A number controlling rule precedence. Higher priority rules override lower ones on conflict.

#### How Memory Rules are Loaded

- Wave recursively discovers all \`.md\` files in \`.wave/rules/\` and \`~/.wave/rules/\`.
- **Path-specific activation**: If a rule has a \`paths\` field, it is only included in the agent's context when a file being read or modified matches the glob patterns.
- **Unconditional rules**: Rules without a \`paths\` field are always active.
- **Priority**: Project-level rules take priority over user-level rules if there is a conflict.

#### Best Practices

- **Keep rules focused**: Create separate files for different topics (e.g. \`testing.md\`, \`ui-components.md\`).
- **Leverage path scoping**: Use the \`paths\` field to keep the agent's context window clean and relevant.
- **Share with your team**: Commit \`.wave/rules/\` to your git repository.

## Auto-Memory

In addition to manual memory files, Wave has an **auto-memory** feature that automatically extracts and remembers important information across sessions. This is stored in \`~/.wave/projects/<project-id>/memory/MEMORY.md\`.

You can control auto-memory in \`settings.json\`:

- \`autoMemoryEnabled\`: Enable or disable auto-memory (default: \`true\`).
- \`autoMemoryFrequency\`: Frequency of auto-memory extraction turns (default: \`1\`).
`,
  "skills/settings/MODELS.md": `# Model Configuration

Wave allows you to configure model-specific parameters directly in your \`settings.json\`. This gives you fine-grained control over reasoning quality, token cost, and latency for different models.

## Model Overrides

You can define overrides for specific models in the \`models\` field. The key should be the exact model name used by Wave.

\`\`\`json
{
  "models": {
    "claude-3-7-sonnet-20250219": {
      "options": {
        "thinking": {
          "type": "enabled",
          "budget_tokens": 1024
        },
        "temperature": 1.0
      }
    },
    "o3-mini": {
      "options": {
        "reasoning_effort": "high"
      }
    },
    "gpt-4o": {
      "options": {
        "temperature": 0.5
      }
    }
  }
}
\`\`\`

## Supported Parameters

Generation parameters are nested under the \`options\` field within each model's configuration. Wave supports passing arbitrary parameters to the underlying AI provider. Common parameters include:

- \`temperature\`: Controls randomness (0.0 to 2.0).
- \`max_tokens\`: Maximum number of tokens to generate in the response.
- \`reasoning_effort\`: (OpenAI specific) Controls the reasoning effort for models like \`o1\` and \`o3-mini\`. Values: \`low\`, \`medium\`, \`high\`.
- \`thinking\`: (Claude specific) Configures the thinking/reasoning capabilities for Claude 3.7+ models.
  - \`type\`: \`"enabled"\` or \`"disabled"\`.
  - \`budget_tokens\`: Maximum tokens to use for thinking.

## Per-Model Input Context Window

Set \`maxInputTokens\` at the top level of a model entry (not inside \`options\`) to define that model's input context window. It overrides the global \`WAVE_MAX_INPUT_TOKENS\`, so compaction thresholds and usage display follow each model's own value:

\`\`\`json
{
  "models": {
    "deepseek-v4-flash": { "maxInputTokens": 200000 },
    "kimi-k3": { "maxInputTokens": 131072 }
  }
}
\`\`\`

Resolution priority: constructor > \`options\` > \`models[<model>].maxInputTokens\` > \`WAVE_MAX_INPUT_TOKENS\` > default. Subagents (\`fastModel\`/\`visionModel\`) resolve against the model they actually use.

## Model Capabilities

Wave needs to know whether a model supports certain features. Instead of guessing from the model name, you declare these explicitly via the \`capabilities\` field. Note that \`capabilities\` is set at the top level of the model configuration, **not** inside the \`options\` field — \`options\` is reserved for generation parameters only.

- \`vision\` (default: \`true\`): Whether the model can accept image inputs. When \`false\`, images are stripped and replaced with text placeholders.
- \`promptCaching\` (default: \`false\`): Whether the model supports ephemeral prompt caching (e.g., Anthropic's \`cache_control\` markers). When \`true\`, Wave injects cache markers on the system prompt and last user message.

\`\`\`json
{
  "models": {
    "claude-3-7-sonnet-20250219": {
      "capabilities": {
        "vision": true,
        "promptCaching": true
      }
    },
    "deepseek-r1": {
      "capabilities": {
        "vision": false,
        "promptCaching": false
      }
    }
  }
}
\`\`\`

You can also set \`capabilities\` at the top level of \`settings.json\` to apply to the default model:

\`\`\`json
{
  "capabilities": {
    "vision": true,
    "promptCaching": false
  }
}
\`\`\`

## Unsetting Default Parameters

If a model does not support a default parameter (like \`temperature\` for some reasoning models), you can explicitly set it to \`null\` inside the \`options\` field to ensure it is not sent to the provider.

\`\`\`json
{
  "models": {
    "o1-preview": {
      "options": {
        "temperature": null
      }
    }
  }
}
\`\`\`

## Global Model Selection

You can also set the default models Wave uses via environment variables in \`settings.json\`:

\`\`\`json
{
  "env": {
    "WAVE_MODEL": "gemini-3-flash",
    "WAVE_FAST_MODEL": "gemini-2.5-flash",
    "WAVE_VISION_MODEL": "qwen-vl-max",
    "WAVE_MAX_INPUT_TOKENS": "100000",
    "WAVE_MAX_OUTPUT_TOKENS": "4096"
  }
}
\`\`\`

\`WAVE_VISION_MODEL\` names a vision-capable model for the built-in \`vision\` subagent. Setting it registers the subagent, whose frontmatter \`model: visionModel\` resolves to this value — so a fast non-vision main model can delegate image recognition. Leave it unset to disable the built-in \`vision\` subagent.

## Live Reload

Model configurations support **live reload**. When you modify the \`models\` field or model-related environment variables in \`settings.json\`, the changes take effect immediately without restarting Wave.
`,
  "skills/settings/PERMISSIONS.md": `# Tool Permissions & Safe Zone

Wave includes a robust permission system to protect your system while allowing the AI to be productive. This system is centered around the "Safe Zone" and configurable permission modes.

## The Safe Zone

The Safe Zone is a set of directories where Wave is allowed to perform potentially sensitive operations (like editing or writing files) with reduced friction.

By default, the Safe Zone includes:
- The current project directory.
- The Wave configuration directories (\`~/.wave/\` and \`.wave/\`).
- The system temporary directory.

You can extend the Safe Zone by adding \`additionalDirectories\` to your \`permissions\` configuration in \`settings.json\`.

## Permission Modes

The \`permissionMode\` setting determines how Wave handles requests to use restricted tools (e.g., \`Bash\`, \`Edit\`, \`Write\`, \`AskUserQuestion\`).

| Mode | Description |
| :--- | :--- |
| \`default\` | **Recommended.** Wave will ask for your permission before using any restricted tool. |
| \`bypassPermissions\` | **Use with caution.** Wave will execute all tools without asking for permission. |
| \`acceptEdits\` | Wave will automatically allow \`Edit\` and \`Write\` operations within the Safe Zone. It will still ask for permission for \`Bash\` and operations outside the Safe Zone. |
| \`plan\` | Restricted mode for editing the plan file (usually internal). |
| \`dontAsk\` | Wave will automatically deny all restricted tools without asking. This is the most restrictive mode. |

### Example Configuration

\`\`\`json
{
  "permissions": {
    "permissionMode": "default",
    "additionalDirectories": ["/home/user/my-exports"],
    "allow": ["ls -R", "git status"],
    "deny": ["rm -rf"]
  }
}
\`\`\`

## Allow and Deny Rules

You can pre-approve or explicitly forbid specific operations using \`allow\` and \`deny\` rules.

- **\`allow\`**: An array of string patterns (e.g., bash commands or file paths) that are always permitted.
- **\`deny\`**: An array of string patterns that are always forbidden.

When a tool is called, Wave checks:
1. If the operation matches a \`deny\` rule, it is rejected.
2. If the operation matches an \`allow\` rule, it is permitted.
3. If no rules match, the behavior depends on the \`permissionMode\`.

### Rule Syntax

Rules use the format \`ToolName(pattern)\`. The wildcard \`*\` has different semantics depending on the tool type:

**Bash rules** — \`*\` matches everything including \`/\` (regex-style):

\`\`\`json
{ "allow": ["Bash(git status*)", "Bash(npm run *)"] }
\`\`\`

- \`Bash(git status*)\` matches \`git status\`, \`git status -s\`, \`git status --short\`
- \`Bash(npm run *)\` matches \`npm run build\`, \`npm run test:unit\`
- \`*\` → \`.*\` regex conversion, so \`Bash(node */scripts/*.mjs*)\` matches \`node plugins/code2cwspec/scripts/check-manifest.mjs\`

**File tool rules** (\`Read\`, \`Write\`, \`Edit\`) — \`*\` does NOT cross \`/\` (glob-style, use \`**\` for directories):

\`\`\`json
{ "allow": ["Read(**/*.env)", "Write(src/**/*.ts)"] }
\`\`\`

- \`Read(*.env)\` matches \`local.env\` but NOT \`config/local.env\`
- \`Read(**/*.env)\` matches \`local.env\`, \`config/local.env\`, \`a/b/c.env\`
- Uses \`minimatch\` glob semantics

| Tool | \`*\` matches \`/\`? | Semantics | Example |
| :--- | :--- | :--- | :--- |
| \`Bash(...)\` | Yes | Regex \`.*\` | \`Bash(npm *)\` → any npm command |
| \`Read(...)\` | No | Glob (use \`**\`) | \`Read(**/*.env)\` → any depth \`.env\` |
| \`Write(...)\` | No | Glob (use \`**\`) | \`Write(src/**/*.ts)\` → any \`.ts\` in src |
| \`Edit(...)\` | No | Glob (use \`**\`) | \`Edit(**/*.json)\` → any \`.json\` |

## Managing Permissions via CLI

You can also manage permissions directly through the Wave interface:
- When Wave asks for permission, you can select "Always allow" to add a rule to your \`settings.local.json\`.
- You can ask Wave to "Update my permission mode to acceptEdits".
`,
  "skills/settings/PLUGINS.md": `# Wave Plugins & Plugin Marketplaces

This guide covers creating plugins, publishing plugin marketplaces, and installing plugins from marketplaces.

## Plugins

Plugins bundle skills, hooks, MCP servers, LSP servers, and slash commands into a reusable package.

### Creating a Plugin

A plugin is any directory containing a \`.wave-plugin/plugin.json\` manifest:

\`\`\`json
{
  "name": "my-plugin",
  "description": "A plugin that adds code review capabilities",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
\`\`\`

Plugin name must match \`^[a-z0-9-]+$\` (lowercase letters, numbers, hyphens only).

Place resources in standard directories within the plugin:

| Directory / File | Purpose |
|-----------------|---------|
| \`skills/\` | Skill directories, each containing a \`SKILL.md\` file |
| \`commands/\` | Custom slash command definitions |
| \`hooks/hooks.json\` | Hook configuration |
| \`.lsp.json\` | LSP server configuration |
| \`.mcp.json\` | MCP server configuration |

Only \`plugin.json\` should exist in \`.wave-plugin/\` — any other files there will cause a validation error.

### Installing a Plugin Locally

Add a plugin directly in \`settings.json\`:

\`\`\`json
{
  "plugins": [
    {
      "type": "local",
      "path": "/path/to/my-plugin"
    }
  ]
}
\`\`\`

### \`\${WAVE_PLUGIN_ROOT}\` Placeholder

Plugin skills, hooks, MCP servers, and LSP servers can reference their parent plugin's directory using \`\${WAVE_PLUGIN_ROOT}\`. Wave substitutes this placeholder with the plugin's absolute directory path at load time, and also injects \`WAVE_PLUGIN_ROOT\` as an environment variable into spawned processes.

Example hook command:
\`\`\`json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\\"\${WAVE_PLUGIN_ROOT}/hooks/session-start\\"",
            "async": false
          }
        ]
      }
    ]
  }
}
\`\`\`

## Plugin Marketplaces

A plugin marketplace is a git repository containing a \`.wave-plugin/marketplace.json\` that lists available plugins.

### Marketplace Manifest

\`\`\`json
{
  "name": "my-plugins",
  "owner": {
    "name": "Your Name"
  },
  "plugins": [
    {
      "name": "review-plugin",
      "description": "Adds a /review command for code reviews",
      "source": "./plugins/review-plugin"
    },
    {
      "name": "remote-plugin",
      "description": "Plugin hosted on a remote git repo",
      "source": "https://github.com/user/remote-plugin.git"
    }
  ]
}
\`\`\`

- \`source\` can be a **relative path** (resolved from the marketplace repo root) or a **git URL** (\`https://\`, \`git@\`, \`ssh://\`) for remote repos.
- Each plugin at its source path must have its own \`.wave-plugin/plugin.json\` manifest.

### Registering a Marketplace

Add a marketplace in \`settings.json\`:

\`\`\`json
{
  "marketplaces": {
    "my-plugins": {
      "source": {
        "source": "github",
        "repo": "user/my-plugins"
      }
    }
  }
}
\`\`\`

**Source types:**

| Type | Format | Example |
|------|--------|---------|
| GitHub | \`{ "source": "github", "repo": "owner/repo", "ref": "branch" }\` | Clones from \`github.com/owner/repo\` |
| Git URL | \`{ "source": "git", "url": "https://...", "ref": "branch" }\` | Clones from any git remote |
| Directory | \`{ "source": "directory", "path": "/local/path" }\` | Uses a local directory |

### Installing from a Marketplace

Install a plugin using the format \`plugin-name@marketplace-name\`:

\`\`\`
/install-plugin my-plugin@my-plugins
\`\`\`

Wave clones the marketplace repo, reads the manifest, and copies the plugin to its cache directory.

### Creating a Plugin Marketplace

1. Create a git repository
2. Add \`.wave-plugin/marketplace.json\` at the root
3. Add plugin directories with their own \`.wave-plugin/plugin.json\`
4. Register the marketplace in your \`settings.json\` using a github, git, or directory source
5. Plugins are cloned to the cache directory on install

### Updating Plugins

Marketplaces with \`autoUpdate: true\` are checked for updates on startup:

\`\`\`json
{
  "marketplaces": {
    "my-plugins": {
      "source": { "source": "github", "repo": "user/my-plugins" },
      "autoUpdate": true
    }
  }
}
\`\`\`

### Marketplace Scopes

Marketplace declarations can be scoped:
- **User scope**: \`~/.wave/settings.json\` — available in all projects
- **Project scope**: \`.wave/settings.json\` — available in this project only
- **Local scope**: \`.wave/settings.local.json\` — not committed to git

Later scopes override earlier ones (local > project > user).
`,
  "skills/settings/SKILL.md": `---
name: settings
description: Manage Wave settings and get guidance on settings.json, hooks, environment variables, permissions, MCP servers, memory, skills, subagents, plugins, and plugin marketplaces. Use this when the user wants to view, update, or learn how to configure Wave.
---

# Wave Settings Skill

This skill helps you manage your Wave configuration and provides guidance on how to use \`settings.json\`.

## What is \`settings.json\`?

\`settings.json\` is the central configuration file for Wave. It allows you to customize hooks, environment variables, tool permissions, and more.

### Live Reload

Changes to \`settings.json\` take effect immediately without restarting Wave. When you modify any setting, the new configuration is applied to subsequent operations automatically.

Wave looks for \`settings.json\` in three scopes:
1.  **User Scope**: Global settings for all projects. Located at \`~/.wave/settings.json\`.
2.  **Project Scope**: Settings specific to the current project. Located at \`.wave/settings.json\` in your project root.
3.  **Local Scope**: Local overrides for the current project (not committed to git). Located at \`.wave/settings.local.json\`.

## Common Settings

### 1. Hooks
Hooks allow you to automate tasks when certain events occur (e.g., \`PreToolUse\`, \`PostToolUse\`, \`SessionStart\`, \`SessionEnd\`).
For detailed hook configuration, see [HOOKS.md](\${WAVE_SKILL_DIR}/HOOKS.md).

### 2. Environment Variables
Set environment variables that will be available to all tools and hooks. Common \`WAVE_*\` variables include:
- \`WAVE_MODEL\`, \`WAVE_FAST_MODEL\`: Model selection
- \`WAVE_MAX_INPUT_TOKENS\`, \`WAVE_MAX_OUTPUT_TOKENS\`: Token limits
- \`WAVE_API_KEY\`, \`WAVE_BASE_URL\`: API configuration

For detailed configuration, see [ENV.md](\${WAVE_SKILL_DIR}/ENV.md).
\`\`\`json
{
  "env": {
    "NODE_ENV": "development",
    "API_KEY": "your-api-key"
  }
}
\`\`\`

### 3. Permissions
Manage tool permissions and define the "Safe Zone". Changes to permissions take effect immediately with live reload.
For detailed permission configuration and available permission modes, see [PERMISSIONS.md](\${WAVE_SKILL_DIR}/PERMISSIONS.md).
\`\`\`json
{
  "permissions": {
    "allow": ["Bash", "Read"],
    "deny": ["Write"],
    "permissionMode": "default",
    "additionalDirectories": ["/tmp/wave-exports"]
  }
}
\`\`\`

### 4. Model Configuration
Define which AI models Wave should use and set model-specific parameters like \`temperature\`, \`reasoning_effort\`, and \`thinking\`. You can also configure model selection and token limits via environment variables in the \`env\` field.
For detailed model configuration, see [MODELS.md](\${WAVE_SKILL_DIR}/MODELS.md).
\`\`\`json
{
  "models": {
    "claude-3-7-sonnet-20250219": {
      "options": {
        "thinking": {
          "type": "enabled",
          "budget_tokens": 1024
        }
      }
    },
    "o3-mini": {
      "options": {
        "reasoning_effort": "high"
      }
    }
  }
}
\`\`\`

### 5. Model Context Protocol (MCP)
Connect to external servers to provide additional tools and context.
For detailed MCP configuration, see [MCP.md](\${WAVE_SKILL_DIR}/MCP.md).

### 6. Memory
Provide context-specific instructions and knowledge to the agent through user memory, project memory, memory rules, and auto-memory.
For detailed memory configuration, see [MEMORY.md](\${WAVE_SKILL_DIR}/MEMORY.md).

### 7. Skills
Extend Wave's functionality by creating custom skills.
For detailed guidance on creating skills, see [SKILLS.md](\${WAVE_SKILL_DIR}/SKILLS.md).

### 8. Subagents
Delegate tasks to specialized AI personalities.
For detailed guidance on creating subagents, see [SUBAGENTS.md](\${WAVE_SKILL_DIR}/SUBAGENTS.md).

### 9. Plugins

Plugins bundle skills, hooks, MCP servers, LSP servers, commands, and subagents into a reusable package. You can install plugins locally or from a marketplace.
For detailed guidance on creating plugins and marketplaces, see [PLUGINS.md](\${WAVE_SKILL_DIR}/PLUGINS.md).

### 10. Other Settings
- \`language\`: Preferred language for agent communication (e.g., \`"en"\`, \`"zh"\`).
- \`autoMemoryEnabled\`: Enable or disable auto-memory (default: \`true\`).
- \`autoMemoryFrequency\`: Frequency of auto-memory extraction turns (default: \`1\`).
- \`enableArtifact\`: Enable the Artifact tool, which publishes local \`.html\`/\`.md\` files as shareable (default-private) web pages. Defaults to \`false\` while the frame backend is not live; set to \`true\` to register the tool and enable WebFetch interception for artifact URLs. Toggling it hot-reloads the tool registry.
- \`worktree.baseRef\`: Base ref for new worktrees. \`"fresh"\` (default) creates a new branch from \`origin/<default branch>\`; \`"head"\` branches from the current local HEAD, skipping origin resolution and network fetch. Use \`"head"\` when working from un-pushed local branches.

\`\`\`json
{
  "enableArtifact": true
}
\`\`\`

## How to use this skill

You can ask me to:
- "Show my current settings"
- "Update my project settings to enable auto-memory"
- "How do I configure a post-commit hook?"
- "What are the available permission modes?"
- "Update my permission mode to acceptEdits"
- "How do I extend the Safe Zone for permissions?"
- "How do I create a custom skill?"
- "How do I define a new subagent?"
- "How do I set max input tokens?"
- "How do I change the model?"
- "How do I create a Wave plugin?"
- "How do I set up a plugin marketplace?"
- "How do I install a plugin from a marketplace?"

I will guide you through the process and ensure your configuration is valid.
`,
  "skills/settings/SKILLS.md": `# Creating and Managing Wave Skills

Skills are discoverable capabilities that extend Wave's functionality. They allow you to package instructions, tools, and scripts into reusable modules.

## Skill Structure

A skill is a directory containing a \`SKILL.md\` file.

\`\`\`text
my-skill/
├── SKILL.md          # Main skill definition (required)
├── reference.md      # Supporting documentation (optional)
├── scripts/          # Custom scripts (optional)
└── templates/        # Code templates (optional)
\`\`\`

## The \`SKILL.md\` File

The \`SKILL.md\` file uses YAML frontmatter for configuration and Markdown for instructions. When \`context: fork\` is used, the Markdown body is passed as the initial prompt to the subagent.

\`\`\`markdown
---
name: my-skill
description: A brief description of what the skill does.
context: fork
allowed-tools:
  - Bash
  - Read
---

# My Skill Instructions

When this skill is invoked, follow these steps:
1. Use the \`Read\` tool to examine the project structure.
2. Use the \`Bash\` tool to run \`npm test\`.
\`\`\`

### YAML Frontmatter Fields

- \`name\`: (Required) Unique identifier (lowercase, numbers, hyphens).
- \`description\`: (Required) Explains when the AI should use this skill.
- \`allowed-tools\`: (Optional) List of tools the skill can use.
- \`context: fork\`: (Optional) Run the skill in a separate subagent.
- \`agent\`: (Optional) Specify the subagent type (default: \`general-purpose\`).
- \`disable-model-invocation\`: (Optional, default: \`false\`) Set to \`true\` to hide the skill from the AI's available skills list. The skill can still be invoked by users via slash commands.
- \`user-invocable\`: (Optional, default: \`true\`) Set to \`false\` to hide the skill from the \`/\` slash command menu. The AI can still invoke it unless \`disable-model-invocation\` is also set.
- \`model\`: (Optional) Override the AI model used for skill execution (e.g., \`"gpt-4o"\`, \`"o3-mini"\`).

## Skill Locations

Wave looks for skills in multiple locations, with later sources overriding earlier ones for same-named skills:

1.  **User Skills**: \`~/.agents/skills/\` → \`~/.claude/skills/\` → \`~/.wave/skills/\` (Available in all projects)
2.  **Project Skills**: \`.agents/skills/\` → \`.claude/skills/\` → \`.wave/skills/\` (Specific to the current project)

The \`.agents/skills\` directory is the cross-tool standard adopted by Codex, Cursor, Cline, Gemini CLI, GitHub Copilot, and OpenCode, so a single skill directory can be shared across all your AI tools.

Project skills take precedence over user skills with the same name. Within each level, \`.wave\` overrides \`.claude\`, which overrides \`.agents\`.

## Invoking Skills

- **AI-Invoked**: The agent automatically discovers and uses skills based on their \`description\`.
- **User-Invoked**: Use slash commands in the CLI (e.g., \`/my-skill\`).

## Bash Command Substitution

You can embed shell commands in skill content using two syntaxes. Commands are executed and their output is inserted inline when the skill is invoked.

### Inline Syntax

Use \`!\`command\`\` for single-line commands:

\`\`\`markdown
Current git status: !\`git status --short\`
\`\`\`

### Block Syntax

Use \` \`\`\`! \` code blocks for multi-line commands:

\`\`\`markdown
\`\`\`!
git log --oneline -10
\`\`\`
\`\`\`

Blocks are processed before inline commands, with results replaced in order of appearance.

### Output Limits

- Output is capped at **30,000 characters** per command.
- When truncated, a 2,048-character preview is shown along with a temp file path containing the full output.

### Safe Replacement

Shell output containing special strings like \`$$\`, \`$&\`, \`$'\` is replaced safely without corruption.

### Empty Commands

Empty or whitespace-only commands are silently skipped.

## Best Practices

- **Clear Descriptions**: Write descriptions that help the AI understand exactly when the skill is relevant.
- **Modular Design**: Keep skills focused on a single task or capability.
- **Use \`\${WAVE_SKILL_DIR}\`**: Use this placeholder to reference files within the skill directory.
- **Bash Commands**: Use \`!\`command\`\` for inline output or \` \`\`\`! \` blocks for multi-line commands. Keep outputs concise.
`,
  "skills/settings/SUBAGENTS.md": `# Creating and Managing Wave Subagents

Subagents are specialized AI personalities that Wave can delegate tasks to. They have their own context windows, expertise areas, and tool configurations.

## Subagent Structure

A subagent is defined by a Markdown file with YAML frontmatter.

\`\`\`text
.wave/agents/
└── my-subagent.md    # Subagent definition
\`\`\`

## The \`subagent.md\` File

The \`subagent.md\` file uses YAML frontmatter for configuration and Markdown for the system prompt. The Markdown content (excluding frontmatter) is passed directly as the system prompt to the subagent. Avoid using top-level Markdown headers (like \`# My Subagent\`) unless you want them to be part of the system prompt.

\`\`\`markdown
---
name: my-subagent
description: A specialized subagent for a specific task.
tools:
  - Bash
  - Read
model: gemini-3-flash
---

You are a specialized subagent for a specific task. Your goal is to:
1. Use the \`Read\` tool to examine the project structure.
2. Use the \`Bash\` tool to run \`npm test\`.
\`\`\`

### YAML Frontmatter Fields

- \`name\`: (Required) Unique identifier.
- \`description\`: (Required) Explains the subagent's expertise and when to use it.
- \`tools\`: (Optional) List of tools the subagent can use.
- \`model\`: (Optional) Overrides the default model for this subagent. The special values \`fastModel\` and \`visionModel\` resolve to the \`WAVE_FAST_MODEL\` / \`WAVE_VISION_MODEL\` env vars respectively. Built-in subagents declaring \`model: visionModel\` (e.g. the built-in \`vision\` agent) are only registered when \`WAVE_VISION_MODEL\` is set; for user-defined subagents the value simply resolves to the configured vision model.

## Subagent Locations

Wave looks for subagents in three locations:

1.  **User Subagents**: \`~/.wave/agents/\` (Available in all projects)
2.  **Project Subagents**: \`.wave/agents/\` (Specific to the current project)
3.  **Plugin Agents**: \`agents/\` within an installed plugin directory (Scoped to the plugin)

Project subagents take precedence over user subagents with the same name. Plugin agents are namespaced with the plugin name (e.g., \`pluginName:agentName\`) to avoid collisions.

## Plugin Agents

Plugins can define their own subagents in an \`agents/\` directory within the plugin. These agents can reference their parent plugin's directory using the \`\${WAVE_PLUGIN_ROOT}\` template variable, which is substituted at load time.

For example, a plugin at \`/path/to/my-plugin/\` with \`agents/researcher.md\`:

\`\`\`markdown
---
name: researcher
description: A research agent that uses the plugin's knowledge base
tools: ["Read", "Glob"]
---

You are a research assistant. Access plugin resources at \${WAVE_PLUGIN_ROOT}/data.
\`\`\`

After loading, \`\${WAVE_PLUGIN_ROOT}\` is replaced with \`/path/to/my-plugin/\`, and the agent is registered as \`my-plugin:researcher\`.

## Delegating to Subagents

- **Automatic Delegation**: Wave automatically recognizes when a task matches a subagent's expertise and delegates to it.
- **Explicit Delegation**: You can explicitly request a specific subagent for a task.

## Best Practices

- **Focused Expertise**: Define subagents with clear, specific roles (e.g., "Testing Expert", "Refactoring Specialist").
- **Detailed System Prompts**: Provide clear instructions and guidelines in the system prompt to ensure consistent behavior.
- **Tool Selection**: Only provide the tools that are necessary for the subagent's role.
`,
};
