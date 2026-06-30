# Quickstart: Print Mode

## Overview
Print mode (`wave -p 'message'`) runs the agent non-interactively and outputs only the main agent's response to stdout. It is designed for scripting and piping.

## How to use

### Basic Usage

```bash
# Simple prompt
wave -p 'Explain what this project does'

# Pipe output to a file
wave -p 'List all TODO comments' > todos.txt

# Chain with other commands
wave -p 'What is the main entry point?' | grep -i index
```

### What you'll see

Print mode outputs:
- `💭 Reasoning:` — if the agent reasons before responding
- `📝 Response:` — the main agent's response text
- `🔧 <tool_name> <params>` — tool calls made by the main agent
- `❌ Error: <message>` — any errors

### What you won't see

Print mode suppresses all subagent output:
- No subagent system prompts or instructions
- No subagent file manifests (e.g., auto-memory extraction file lists)
- No subagent reasoning or streaming content
- No subagent tool call indicators

The main agent incorporates relevant subagent results in its own response.

## Example Session

```text
$ wave -p 'What does the build script do?'

💭 Reasoning:
Let me check the build configuration.

🔧 Read package.json

📝 Response:
The build script runs `rimraf dist && tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json`, which cleans the output directory, compiles TypeScript, and resolves path aliases.
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success — agent responded |
| 1 | Error — agent failed or message was empty |
