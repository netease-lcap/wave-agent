# Quickstart: Tools Selection

This guide explains how to use the `--tools` flag to control which tools are available to the agent in a CLI session.

## Overview

By default, the agent has access to a full suite of tools (Bash, Edit, Read, etc.). You can now limit these tools for security, focus, or to create a "chat-only" experience.

## Usage

### 1. Enable Specific Tools

To limit the agent to only a few tools, provide a comma-separated list of tool names:

```bash
wave --tools "Read,Edit"
```

In this session, the agent will only be able to read and edit files. It will not have access to `Bash`, `Grep`, or other tools.

### 2. Disable All Tools

To disable all tools and use the agent in a "chat-only" mode, provide an empty string:

```bash
wave --tools ""
```

The agent will still be able to communicate with you but will not be able to perform any actions on your system.

### 3. Use Default Tools

To use the standard set of tools, you can omit the flag or explicitly use the `"default"` keyword:

```bash
wave --tools "default"
```

### 4. Use with Print Mode

The `--tools` flag also works with the `--print` (or `-p`) option:

```bash
wave --print --tools "Read" "Summarize this file"
```

## Available Tools

The standard built-in tools include:
- `Bash`: Execute shell commands.
- `Edit`: Modify file contents.
- `Read`: Read file contents.
- `Glob`: Find files by pattern.
- `Grep`: Search for text in files.
- `Lsp`: Code intelligence (definitions, references).
- `Task`: Delegate to subagents.
- `Skill`: Invoke custom skills.

## SDK Usage

If you are using the `wave-agent-sdk` directly, you can pass the `tools` option to `Agent.create`:

```typescript
import { Agent } from 'wave-agent-sdk';

const agent = await Agent.create({
  tools: ['Read', 'Edit'],
  // ... other options
});
```

- `tools: undefined` (default): All tools enabled.
- `tools: []`: All tools disabled.
- `tools: ['Name1', 'Name2']`: Only specific tools enabled.
