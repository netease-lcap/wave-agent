# Quickstart: Developing Complex Plugins

This guide covers how to add Skills, LSP servers, MCP servers, and Hooks to your Wave Agent plugin.

## Plugin Structure

Your plugin should follow this directory structure:

```text
my-plugin/
├── .wave-plugin/
│   └── plugin.json      # Required manifest
├── commands/            # Slash commands (.md files)
├── skills/              # Agent Skills
│   └── my-skill/
│       └── SKILL.md
├── hooks/
│   └── hooks.json       # Event handlers
├── .lsp.json            # LSP server configuration
└── .mcp.json            # MCP server configuration
```

**Important**: Do NOT put `commands/`, `skills/`, `hooks/`, `.lsp.json`, or `.mcp.json` inside the `.wave-plugin/` directory.

## Adding a Skill

1. Create a directory `skills/my-skill/`.
2. Create a `SKILL.md` file inside it:

```markdown
---
name: my-skill
description: A brief description of what this skill does.
---

Instructions for the Agent on how to use this skill.
```

## Adding an LSP Server

Create a `.lsp.json` file in the plugin root:

```json
{
  "my-lang": {
    "command": "my-lsp-server",
    "args": ["--stdio"],
    "extensionToLanguage": {
      ".mylang": "my-lang"
    }
  }
}
```

## Adding an MCP Server

Create a `.mcp.json` file in the plugin root:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    }
  }
}
```

## Adding Hooks

Create a `hooks/hooks.json` file in the plugin root:

```json
{
  "UserPromptSubmit": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "echo 'Processing prompt...'"
        }
      ]
    }
  ]
}
```

## Installation

To use your plugin, add it to your `wave.settings.json` or pass it to `Agent.create`:

```json
{
  "plugins": [
    {
      "type": "local",
      "path": "./path/to/my-plugin"
    }
  ]
}
```

Restart Agent Code to load the new capabilities.
