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

# AI model (required)
export WAVE_MODEL="MiniMax-M2.7"

# Fast AI model (required)
export WAVE_FAST_MODEL="MiniMax-M2.7-highspeed"
```

### Optional Environment Variables

```bash
# Token limit (optional, defaults to 96000)
export WAVE_MAX_INPUT_TOKENS="96000"
```

## Usage

```bash
# Start the CLI
wave-code -h
```

### Short Command (wave)

For convenience, you can also use the shorter `wave` command:

```bash
# Start the CLI
wave -h
```

The `wave` command is an alias for `wave-code` and supports all the same options and functionality.

## License

MIT
