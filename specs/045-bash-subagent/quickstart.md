# Quickstart: Bash Subagent

The Bash subagent is a built-in specialist for executing terminal commands and git operations.

## Usage

The main agent will automatically delegate tasks to the Bash subagent when it identifies a need for complex command execution.

### Example Scenarios

1. **Git Operations**: "Rebase my current branch onto main and fix any conflicts."
2. **Complex Commands**: "Find all files larger than 1MB and compress them."
3. **Environment Setup**: "Install all dependencies and run the build script."

## Configuration

The Bash subagent is enabled by default as a built-in agent. It inherits the model settings from your main agent configuration.

## Safety

The Bash subagent follows strict safety protocols for git operations and path quoting to prevent accidental data loss.
