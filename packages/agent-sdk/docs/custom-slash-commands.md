# Custom Slash Commands

Custom slash commands allow you to create reusable AI prompts that can be executed through the Wave agent. These commands are stored as markdown files and can include configuration options and bash command execution.

## File Locations

Custom slash commands are stored in designated directories based on their scope:

- **Project commands**: `.wave/commands/` - Available only in the current project
- **Personal commands**: `~/.wave/commands/` - Available across all your projects

## File Format

Each custom command is a markdown file where:

- The filename (without `.md` extension) becomes the command name
- The file content defines what the command does
- Optional YAML frontmatter provides configuration

## Basic Example

Create `.wave/commands/refactor.md`:

```markdown
Refactor the selected code to improve readability and maintainability.
Focus on clean code principles and best practices.
```

This creates the `/refactor` command that you can use through the SDK.

## With Frontmatter

Create `.wave/commands/security-check.md`:

```markdown
---
description: Analyze codebase for security vulnerabilities and potential risks
allowed-tools: Read, Grep, Glob
model: claude-3-5-sonnet-20241022
---

Analyze the codebase for security vulnerabilities including:

- SQL injection risks
- XSS vulnerabilities
- Exposed credentials
- Insecure configurations
```

## Bash Command Execution

Custom commands can execute bash commands and include their output:

Create `.wave/commands/git-commit.md`:

```markdown
---
allowed-tools: Bash
---

## Context

- Current status: !`git status`
- Current diff: !`git diff HEAD`

## Task

Create a git commit with appropriate message based on the changes.
```

Bash commands are written using the `!`backtick`` syntax. They will be executed and their output will replace the command in the prompt sent to the AI.

## Configuration Options

### Frontmatter Options

- `description`: Custom description for the command that appears in the command selector
- `allowed-tools`: Array of tool names that the agent can use for this command (e.g., `Read, Grep, Glob`)
- `model`: Specific AI model to use for this command (e.g., `claude-3-5-sonnet-20241022`)

## Technical Implementation

- **Main Agent Context**: Custom commands execute directly within the main agent conversation
- **Tool Filtering**: If `allowed-tools` is specified, only those tools are available during command execution
- **Model Override**: Commands can specify a different model to use temporarily
- **Bash Execution**: Commands marked with `!`backtick`` are executed before sending to AI
- **Seamless Integration**: Command responses are added directly to the main conversation

## Usage Examples

```typescript
import { Agent } from "wave-agent-sdk";

const agent = await Agent.create({
  callbacks: {
    // Custom commands now execute directly in main agent
    onMessageAdded: (message) => {
      console.log(`New message added:`, message);
    },
  },
});

// List available commands
const commands = agent.getSlashCommands();

// Get custom command details
const customCommands = agent.getCustomCommands();

// Execute a custom command
await agent.executeSlashCommand("refactor");

// Reload custom commands (useful during development)
agent.reloadCustomCommands();
```

## Message Structure

When a custom command is executed, it creates a `CustomCommandBlock` in the main conversation:

```typescript
{
  role: "user",
  blocks: [
    {
      type: "custom_command",
      commandName: "refactor",
      content: "Refactor the selected code to improve readability..."
    }
  ]
}
```

The AI's response is then added as a normal assistant message to the main conversation.

## Security Considerations

- Bash commands are executed with the same permissions as the Wave agent process
- Use `allowed-tools` to limit what tools can be used during command execution
- Project commands take precedence over user commands with the same name
- Commands are loaded at startup and when explicitly reloaded

## Development Workflow

1. Create custom command files in `.wave/commands/`
2. Test the commands using the agent
3. Use `agent.reloadCustomCommands()` to reload changes during development
4. Share project-specific commands by committing the `.wave/commands/` directory
