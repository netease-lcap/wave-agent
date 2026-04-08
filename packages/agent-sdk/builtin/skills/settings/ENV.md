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

Wave uses several environment variables to control its core functionality.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `WAVE_API_KEY` | API key for the AI gateway. | - |
| `WAVE_BASE_URL` | Base URL for the AI gateway. | - |
| `WAVE_CUSTOM_HEADERS` | Custom HTTP headers for the AI gateway (JSON string). | - |
| `WAVE_MODEL` | The primary AI model to use for the agent. | `gemini-3-flash` |
| `WAVE_FAST_MODEL` | The fast AI model to use for quick tasks. | `gemini-2.5-flash` |
| `WAVE_MAX_INPUT_TOKENS` | Maximum number of input tokens allowed. | `96000` |
| `WAVE_MAX_OUTPUT_TOKENS` | Maximum number of output tokens allowed. | `8192` |
| `WAVE_DISABLE_AUTO_MEMORY` | Set to `1` or `true` to disable the auto-memory feature. | `false` |
| `WAVE_TASK_LIST_ID` | Explicitly set the task list ID for the session. | (Session ID) |
| `WAVE_PROMPT_CACHE_REGEX` | Regex pattern to match model names that support prompt caching. Models matching this pattern will have cache control markers applied. | `claude` |

## Configuration Scopes

Environment variables can be set in different scopes, with the following precedence (highest to lowest):

1.  **Local Scope**: `.wave/settings.local.json` (Local overrides, ignored by git)
2.  **Project Scope**: `.wave/settings.json` (Project-specific settings, shared via git)
3.  **User Scope**: `~/.wave/settings.json` (Global settings for all projects)
4.  **System Environment**: Variables set in your shell (e.g., `export WAVE_API_KEY=...`)

## Custom Environment Variables

You can also define custom environment variables in the `env` field. These variables will be available to:

- **Hooks**: Any shell command executed as a hook will have these variables in its environment.
- **Tools**: Tools like `Bash` will have access to these variables.

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

Environment variables configured in `settings.json` support **live reload**. When you modify the `env` field in any `settings.json` file (user, project, or local scope), the changes take effect immediately without requiring a Wave session restart.

## Best Practices

- **Use Local Overrides for Secrets**: Never commit sensitive information like `WAVE_API_KEY` to `settings.json`. Use `settings.local.json` instead.
- **Standard Naming**: Use uppercase and underscores for environment variable names (e.g., `MY_VARIABLE`).
- **Avoid Overriding System Variables**: Be careful not to override standard system variables like `PATH` or `HOME` unless you have a specific reason to do so.
