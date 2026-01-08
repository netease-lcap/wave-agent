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
npm install wave-code -g
```

## Environment Configuration

Before use, you need to configure the following environment variables for AI model authentication:

### Required Environment Variables

```bash
# AI Gateway access token (required)
export WAVE_API_KEY="your_token_here"

# AI Gateway API URL (required)
export WAVE_BASE_URL="https://your-api-gateway-url.com"
```

### Optional Environment Variables

```bash
# Specify AI model (optional, defaults to gemini-3-flash)
export WAVE_MODEL="gemini-3-flash"

# Specify fast AI model (optional, defaults to gemini-2.5-flash)
export WAVE_FAST_MODEL="gemini-2.5-flash"

# Token limit (optional, defaults to 96000)
export WAVE_MAX_INPUT_TOKENS="96000"

```

## Usage

### Full Command

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

### Short Command (wave)

For convenience, you can also use the shorter `wave` command:

```bash
# Start the CLI (equivalent to wave-code)
wave

# Continue from last session
wave --continue

# Restore specific session
wave --restore session_id

# List available sessions
wave --list-sessions

# Show help
wave --help
```

The `wave` command is an alias for `wave-code` and supports all the same options and functionality.

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
