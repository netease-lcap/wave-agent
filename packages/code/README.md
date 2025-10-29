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

## Environment Configuration

Before use, you need to configure the following environment variables for AI model authentication:

### Required Environment Variables

```bash
# AI Gateway access token (required)
export AIGW_TOKEN="your_token_here"

# AI Gateway API URL (required)
export AIGW_URL="https://your-api-gateway-url.com"
```

### Optional Environment Variables

```bash
# Specify AI model (optional, defaults to system configured model)
export AIGW_MODEL="gemini-2.5-flash"

# Specify fast AI model (optional, for quick response scenarios)
export AIGW_FAST_MODEL="gemini-1.5-flash"

# Log level (optional, defaults to info)
export LOG_LEVEL="debug"

# Log file path (optional)
export LOG_FILE="/path/to/your/logfile.log"

# Maximum log file size (optional, defaults to 10MB)
export LOG_MAX_FILE_SIZE="10485760"

# Token limit (optional, defaults to 64000)
export TOKEN_LIMIT="64000"

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
