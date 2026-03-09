# Quickstart: Plugin Support

This guide provides a quick overview of how to create, load, and manage plugins in Wave.

## 1. Create a Local Plugin
Create a new directory for your plugin and add a `.wave-plugin/plugin.json` file.

```bash
mkdir my-plugin
mkdir my-plugin/.wave-plugin
cat <<EOF > my-plugin/.wave-plugin/plugin.json
{
  "name": "my-plugin",
  "description": "A sample plugin for Wave.",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "your.email@example.com"
  }
}
EOF
```

## 2. Add a Command
Create a `commands/` directory and add a Markdown file for your command.

```bash
mkdir my-plugin/commands
cat <<EOF > my-plugin/commands/hello.md
# Hello Command
This command says hello to the user.

## Usage
/hello [name]

## Implementation
\`\`\`typescript
export default async function hello(args: string[]) {
  const name = args[0] || "World";
  console.log(\`Hello, \${name}!\`);
}
\`\`\`
EOF
```

## 3. Load the Plugin
Run Wave with the `--plugin-dir` flag to load your local plugin.

```bash
wave --plugin-dir ./my-plugin
```

## 4. Manage Plugins
Use the `plugin` command to enable, disable, or install plugins.

```bash
# Enable a plugin
wave plugin enable my-plugin@local

# Disable a plugin
wave plugin disable my-plugin@local

# Install a plugin from GitHub
wave plugin install https://github.com/user/repo.git
```

## 5. Plugin Structure
A typical plugin structure looks like this:

```
my-plugin/
├── .wave-plugin/
│   └── plugin.json      # Required: Plugin manifest
├── commands/            # Optional: Slash commands
│   └── hello.md
├── skills/              # Optional: Skills
│   └── SKILL.md
├── hooks/               # Optional: Hooks
│   └── HOOK.md
├── agents/              # Optional: Agents
│   └── AGENT.md
├── .lsp.json            # Optional: LSP configuration
└── .mcp.json            # Optional: MCP configuration
```

**Note**: All component directories and config files MUST be at the plugin root level, NOT inside `.wave-plugin/`.
