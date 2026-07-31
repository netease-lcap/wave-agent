# Wave Environment Variables Configuration

Environment variables allow you to customize Wave's behavior, configure AI models, and provide context to hooks and tools. This document provides detailed guidance on how to configure environment variables in `settings.json`.

## The `env` Field

Environment variables are configured in the `env` field of `settings.json`. It is a simple key-value pair of strings.

```json
{
  "env": {
    "WAVE_MODEL": "gemini-3-flash",
    "MY_CUSTOM_VAR": "some-value"
  }
}
```

## Supported `WAVE_*` Environment Variables

Wave uses several environment variables to control its core functionality. Variables marked **OS env only** are read from the OS environment (or constructor / stdio `initialize` params) and are **NOT** read from settings.json `env` — set them in your shell, not in the `env` field.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `WAVE_API_KEY` | API key for the AI gateway. | - |
| `WAVE_BASE_URL` | Base URL for the AI gateway. | - |
| `WAVE_SERVER_URL` | Server URL for SSO authentication. **OS env only** — set via OS env or `options.serverUrl`; not read from settings.json `env` (avoids a startup 401 race). | `https://codechat.codewave.163.com` |
| `WAVE_CUSTOM_HEADERS` | Custom HTTP headers for the AI gateway. Newline-separated `Key: Value` pairs (e.g., `"X-Foo: bar\nAuthorization: Bearer xxx"`). | - |
| `WAVE_MODEL` | The primary AI model to use for the agent. | `gemini-3-flash` |
| `WAVE_FAST_MODEL` | The fast AI model to use for quick tasks. | `gemini-2.5-flash` |
| `WAVE_MAX_INPUT_TOKENS` | Maximum number of input tokens allowed. | `200000` |
| `WAVE_MAX_OUTPUT_TOKENS` | Maximum number of output tokens allowed. | `32000` |
| `WAVE_DISABLE_AUTO_MEMORY` | Set to `1` or `true` to disable the auto-memory feature. | `false` |
| `WAVE_AUTO_MEMORY_FREQUENCY` | Auto memory update frequency. `1` = every turn, `2` = every 2 turns, etc. | `1` |
| `WAVE_TASK_LIST_ID` | Explicitly set the task list ID for the session. | (Session ID) |
| `WAVE_PLUGIN_GIT_TIMEOUT_MS` | Timeout in milliseconds for git operations when installing plugins. **OS env only** (infrastructure). | `300000` |

## Configuration Scopes

Environment variables can be set in different scopes. Wave merges scopes from lowest to highest priority and stores the result in the agent's **per-session environment snapshot**. The snapshot takes priority over OS environment variables but is **NOT written to `process.env`** — this keeps multiple sessions in one `wave --stdio` process from polluting each other.

Precedence (highest to lowest):

1.  **Local Scope**: `.wave/settings.local.json` (Local overrides, ignored by git)
2.  **Project Scope**: `.wave/settings.json` (Project-specific settings, shared via git)
3.  **User Scope**: `~/.wave/settings.json` (Global settings for all projects)
4.  **System Environment**: Variables set in your shell (e.g., `export WAVE_API_KEY=...`). Used as a fallback when a key is absent from the settings snapshot.

> Settings `env` shadows (does not mutate) OS env: a key set in both settings.json `env` and the OS environment resolves to the settings value for that session, while the OS value remains untouched and visible to unrelated processes.

## Custom Environment Variables

You can also define custom environment variables in the `env` field. These variables are stored in the session's environment snapshot and will be available to:

- **Hooks**: Any shell command executed as a hook will have these variables in its environment (merged on top of OS env).
- **Tools**: Tools like `Bash` will have access to these variables (merged on top of OS env).

In `wave --stdio` mode one process hosts multiple sessions; each session keeps its own snapshot, so sessions with different `env` do not pollute each other (no "last session wins").

Example:
```json
{
  "env": {
    "PROJECT_NAME": "my-awesome-project",
    "DEPLOY_TARGET": "staging"
  }
}
```

## Live Reload

Environment variables configured in `settings.json` support **live reload**. When you modify the `env` field in any `settings.json` file (user, project, or local scope), the changes take effect immediately without requiring a Wave session restart — the session's environment snapshot is refreshed and subsequent resolve calls / subprocess spawns use the new values.

## Best Practices

- **Use Local Overrides for Secrets**: Never commit sensitive information like `WAVE_API_KEY` to `settings.json`. Use `settings.local.json` instead.
- **Standard Naming**: Use uppercase and underscores for environment variable names (e.g., `MY_VARIABLE`).
- **Avoid Overriding System Variables**: Be careful not to override standard system variables like `PATH` or `HOME` unless you have a specific reason to do so.
