# Wave Code

CLI-based code assistant powered by AI, built with React and Ink.

This is the frontend UI package of the Wave workspace, providing an interactive command-line interface for AI-powered development assistance.

## Features

- Interactive CLI interface built with React and Ink
- Real-time chat interface with AI assistant
- File browser and editor integration
- Command execution and output display
- Session management and restoration
- Memory context management

## Installation

```bash
npm install wave-code
```

## Usage

```bash
# Start the CLI
wave-code

# Continue from last session
wave-code --continue

# Restore specific session
wave-code --restore session_id

# List available sessions
wave-code --list-sessions
```

## Development

This package depends on `wave-agent-sdk` for core functionality including AI services, tools, and utilities.

```bash
# Install dependencies
pnpm install

# Start development
pnpm dev

# Build
pnpm build

# Test
pnpm test
```

## License

MIT