---
name: settings
description: Manage Wave settings and get guidance on settings.json, hooks, environment variables, permissions, MCP servers, memory rules, skills, and subagents. Use this when the user wants to view, update, or learn how to configure Wave.
---

# Wave Settings Skill

This skill helps you manage your Wave configuration and provides guidance on how to use `settings.json`.

## What is `settings.json`?

`settings.json` is the central configuration file for Wave. It allows you to customize hooks, environment variables, tool permissions, and more.

### Live Reload

Changes to `settings.json` take effect immediately without restarting Wave. When you modify any setting, the new configuration is applied to subsequent operations automatically.

Wave looks for `settings.json` in three scopes:
1.  **User Scope**: Global settings for all projects. Located at `~/.wave/settings.json`.
2.  **Project Scope**: Settings specific to the current project. Located at `.wave/settings.json` in your project root.
3.  **Local Scope**: Local overrides for the current project (not committed to git). Located at `.wave/settings.local.json`.

## Common Settings

### 1. Hooks
Hooks allow you to automate tasks when certain events occur (e.g., `WorktreeCreate`, `TaskStart`).
For detailed hook configuration, see [HOOKS.md](${WAVE_SKILL_DIR}/HOOKS.md).

### 2. Environment Variables
Set environment variables that will be available to all tools and hooks.
For detailed environment variable configuration and available `WAVE_*` variables, see [ENV.md](${WAVE_SKILL_DIR}/ENV.md).
```json
{
  "env": {
    "NODE_ENV": "development",
    "API_KEY": "your-api-key"
  }
}
```

### 3. Permissions
Manage tool permissions and define the "Safe Zone". Changes to permissions take effect immediately with live reload.
For detailed permission configuration and available permission modes, see [PERMISSIONS.md](${WAVE_SKILL_DIR}/PERMISSIONS.md).
```json
{
  "permissions": {
    "allow": ["Bash", "Read"],
    "deny": ["Write"],
    "permissionMode": "default",
    "additionalDirectories": ["/tmp/wave-exports"]
  }
}
```

### 4. Model Configuration
Define which AI models Wave should use and set model-specific parameters like `temperature`, `reasoning_effort`, and `thinking`.
For detailed model configuration, see [MODELS.md](${WAVE_SKILL_DIR}/MODELS.md).
```json
{
  "models": {
    "claude-3-7-sonnet-20250219": {
      "thinking": {
        "type": "enabled",
        "budget_tokens": 1024
      }
    },
    "o3-mini": {
      "reasoning_effort": "high"
    }
  }
}
```

### 5. Model Context Protocol (MCP)
Connect to external servers to provide additional tools and context.
For detailed MCP configuration, see [MCP.md](${WAVE_SKILL_DIR}/MCP.md).

### 6. Memory Rules
Provide context-specific instructions and guidelines to the agent.
For detailed memory rules configuration, see [MEMORY_RULES.md](${WAVE_SKILL_DIR}/MEMORY_RULES.md).

### 7. Skills
Extend Wave's functionality by creating custom skills.
For detailed guidance on creating skills, see [SKILLS.md](${WAVE_SKILL_DIR}/SKILLS.md).

### 8. Subagents
Delegate tasks to specialized AI personalities.
For detailed guidance on creating subagents, see [SUBAGENTS.md](${WAVE_SKILL_DIR}/SUBAGENTS.md).

### 9. Other Settings
- `language`: Preferred language for agent communication (e.g., `"en"`, `"zh"`).
- `autoMemoryEnabled`: Enable or disable auto-memory (default: `true`).
- `autoMemoryFrequency`: Frequency of auto-memory extraction turns (default: `1`).

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

I will guide you through the process and ensure your configuration is valid.
