# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Wave Agent is a monorepo for AI-powered development tools built with Node.js and TypeScript. It provides an interactive CLI-based code assistant with real-time AI chat, file manipulation, and session management.

## Development Commands

### Setup and Installation
```bash
# Install dependencies (use pnpm, not npm)
pnpm install

# Build all packages
pnpm build

# Install CLI globally for testing
cd packages/code && npm link

# Set up required environment variables
export WAVE_API_KEY="your_token_here"
export WAVE_BASE_URL="https://your-api-gateway-url.com"
```

### Development Workflow
```bash
# Watch mode for all packages (parallel)
pnpm watch

# Work on specific package with watch mode
cd packages/agent-sdk && pnpm dev
cd packages/code && pnpm dev

# Build specific package (required after agent-sdk changes before testing in code)
cd packages/agent-sdk && pnpm build
```

### Testing and Quality
```bash
# Run all tests
pnpm test

# Run tests for specific package
cd packages/agent-sdk && pnpm test

# Type checking
pnpm type-check

# Linting
pnpm lint

# Format code
pnpm format
```

### Running the Application
```bash
# Start Wave Agent CLI
wave  # or wave-code

# Debug mode with detailed logging
pnpm wave:debug
# or
LOG_LEVEL=DEBUG wave
```

## Architecture

### Core Structure
- **`packages/agent-sdk/`**: Core SDK (71 files) - AI services, tools, managers, session handling
- **`packages/code/`**: CLI frontend (31 files) - React/Ink UI components and terminal interface
- **`specs/`**: Feature specifications and implementation tasks

### Key Components

#### Agent Class (`packages/agent-sdk/src/agent.ts`)
The main orchestrator with specialized managers:
- `MessageManager`: Message state and JSONL session persistence
- `AIManager`: OpenAI API interactions and streaming
- `ToolManager`: Built-in and MCP tool execution
- `McpManager`: Model Context Protocol server management
- `SubagentManager`: Multi-agent orchestration
- `HookManager`: Event hooks system
- `BackgroundBashManager`: Long-running shell processes

#### Message Flow
```
User Input → ChatInterface → useChat hook → Agent.sendMessage()
→ AIManager → OpenAI API → Tool execution → MessageManager
→ JSONL persistence → UI callbacks → React re-render
```

#### Session Management
- Sessions stored as JSONL files in `~/.wave/projects/{projectdir_encoded}/`
- Session restoration: `wave --restore <sessionId>` or `wave --continue`
- Each message is one JSON line (append-only, streaming-friendly)

### Tools System
1. **Built-in tools** (13 tools): bash, read, write, edit, glob, grep, etc.
2. **MCP tools**: From configured external MCP servers (`.mcp.json`)
3. **Dynamic tools**: Task (subagents), Skill (Wave skills)

### Configuration
Three-tier resolution (highest to lowest priority):
1. Constructor options
2. Environment variables (`WAVE_*`, `LOG_*`)
3. Wave config files (`settings.json`, `.wave/config`)

## Testing Guidelines

### Test Organization
- **`packages/*/tests/`**: Unit tests with mocks (run locally and CI)
- **`packages/*/examples/`**: Integration tests with real operations (run locally with `pnpm tsx`)

### Testing Best Practices
- Use `await Agent.create()` instead of `new Agent()` when testing Agent
- Use HookTester utility for testing hooks
- Use mocking extensively in `tests/` - avoid `mkdtemp`, mock file operations
- Mock stdout/stderr to suppress output during testing
- Type assertions: `as unknown as`, `Awaited<>`, `ReturnType<>`, `typeof`
- Integration examples in `examples/` can create temp directories and send real messages

### Running Tests
```bash
# Run specific integration example
cd packages/agent-sdk && pnpm tsx examples/basic-usage.tsx

# Test framework is Vitest
pnpm test  # All tests
cd packages/agent-sdk && pnpm test  # Package-specific tests
```

## Important Development Notes

### Package Dependencies
- `packages/code` depends on `packages/agent-sdk`
- After modifying `agent-sdk`, **must run `pnpm build`** before testing changes in `code`

### Code Organization
- Use path aliases: `@/*` maps to `src/*`
- Manager pattern: Single responsibility, callback-driven architecture
- Barrel exports: Public APIs exported through `index.ts` files
- Type organization: Domain-separated types (`core.ts`, `messaging.ts`, `mcp.ts`, etc.)

### Specification Implementation
When implementing tasks in `specs/*/tasks.md`:
- Mark tasks as `[X]` completed by editing `tasks.md`
- Task multiple subagents in parallel when possible
- Research codebase thoroughly before planning implementation

### Git Hooks and CI
- Pre-commit: Type checking + lint-staged formatting
- CI runs: build, type-check, lint, test (with 2 retries for flaky tests)
- Node.js 20+ required, uses pnpm@9

## Memory and Context Management
- Project-based memory storage in `~/.wave/memory/{projectdir}/`
- Token-aware context management with configurable limits
- Message compression for long conversations
- Claude cache control for efficient API usage

## MCP Integration
Configure external MCP servers via `.mcp.json` in project root:
```json
{
  "mcpServers": {
    "server-name": {
      "command": "path-to-server",
      "args": ["--arg1", "value1"]
    }
  }
}
```

## Debugging and Logging
- File-based logging with rotation support
- Environment variables: `LOG_LEVEL`, `LOG_FILE`, `LOG_MAX_FILE_SIZE`
- Background bash shells: Monitor with `/bashes` command (interactive UI), use `BashOutput` tool for programmatic access, kill with `KillBash` tool or 'k' key in UI
- Session files are human-readable JSONL for debugging