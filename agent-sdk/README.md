# Wave Agent SDK

SDK for building AI-powered development tools and agents.

This package provides the core functionality for building AI-powered development assistants, including services, tools, and utilities.

## Features

- AI service management with OpenAI integration
- MCP (Model Context Protocol) support
- File system tools (read, write, edit, glob, grep)
- Bash command execution and management
- Session and memory management
- Utility functions for development workflows

## Installation

```bash
npm install wave-agent-sdk
```

## Usage

```typescript
import { Agent, bashTool } from "wave-agent-sdk";

// Initialize AI manager (toolRegistry is managed internally)
const agent = await Agent.create({
  callbacks: {
    onMessagesChange: (messages) => console.log("Messages updated"),
    onLoadingChange: (isLoading) => console.log("Loading:", isLoading),
  },
});

// Use individual tools directly
const result = await bashTool.execute({
  command: "ls -la",
  description: "List files",
});
```

## API Reference

### Services

- `Agent` - Main AI service coordinator
- `AIService` - Direct AI API integration
- `BashManager` - Bash command management
- `McpManager` - Model Context Protocol integration
- `Memory` - Context and memory management
- `Session` - Session persistence and restoration

### Tools

- `bashTool` - Execute bash commands
- `readTool` - Read files
- `writeTool` - Write files
- `editTool` - Edit files with find/replace
- `multiEditTool` - Multiple edits in one operation
- `globTool` - File pattern matching
- `grepTool` - Text search in files
- `lsTool` - List directory contents
- `deleteFileTool` - Delete files

### Utilities

- File filtering and path utilities
- Clipboard integration
- Diff utilities
- Git integration
- Logging and error handling
- Message processing and grouping

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test
pnpm test
```

## License

MIT
