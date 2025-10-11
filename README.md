# Wave Agent

A monorepo containing AI-powered development tools built with React and modern web technologies.

## Project Structure

This is a monorepo that contains multiple packages working together to provide AI-assisted development tools:

### 📦 Packages

#### [`packages/code`](./packages/code)
CLI-based code assistant with interactive terminal interface. Provides real-time chat with AI, file browsing, and session management.

- **Main Command**: `wave-code` or `wave` (short alias)
- **Technology**: React, Ink, Node.js
- **Features**: Interactive CLI, file browser, AI chat, session restoration

#### [`packages/agent-sdk`](./packages/agent-sdk)
Core SDK providing AI services, tools, and utilities used by the CLI frontend.

- **Technology**: TypeScript, Node.js
- **Features**: AI model integration, tool system, memory management

### 🚀 Quick Start

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Build all packages**:
   ```bash
   pnpm build
   ```

3. **Install the CLI globally**:
   ```bash
   cd packages/code && npm link
   ```

4. **Set up environment variables**:
   ```bash
   export AIGW_TOKEN="your_token_here"
   export AIGW_URL="https://your-api-gateway-url.com"
   ```

5. **Start using**:
   ```bash
   wave  # or wave-code
   ```

## Development

### Prerequisites

- Node.js 18+
- pnpm (preferred package manager)

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd wave-agent

# Install dependencies for all packages
pnpm install

# Build all packages
pnpm build
```

### Working with Packages

```bash
# Work on a specific package
cd packages/code
pnpm dev

# Run tests for all packages
pnpm test

# Build specific package
cd packages/agent-sdk
pnpm build
```

### Package Dependencies

- `packages/code` depends on `packages/agent-sdk`
- After modifying `agent-sdk`, run `pnpm build` in that package before testing changes in `code`

## Environment Configuration

在使用前，需要配置以下环境变量用于AI模型鉴权：

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

# Disable raw mode (optional, for testing)
export DISABLE_RAW_MODE="false"
```

### Setting Environment Variables

#### Method 1: Set in command line

```bash
export AIGW_TOKEN="your_token_here"
export AIGW_URL="https://your-api-gateway-url.com"
wave  # or wave-code
```

#### Method 2: Use .env file

Create a `.env` file and add:

```
AIGW_TOKEN=your_token_here
AIGW_URL=https://your-api-gateway-url.com
```

#### Method 3: Set in shell configuration

Add environment variables to `~/.bashrc`, `~/.zshrc`, or your corresponding shell configuration file.

⚠️ **Important**: Without setting `AIGW_TOKEN` and `AIGW_URL` environment variables, the model cannot authenticate and the application will not work properly.

## Installation

### Global Installation

```bash
npm install -g wave-code
```

## Usage

### Command Line Usage

```bash
# Open current directory
wave  # or wave-code

# Show help
wave --help  # or wave-code --help
```

Both `wave` and `wave-code` commands are available and provide identical functionality.

## Documentation

- [Logging System](docs/logging.md) - Log configuration and debugging methods
- [Image Paste Feature](docs/image-paste.md) - Image paste and processing functionality
- [Pagination Feature](docs/PAGINATION.md) - File list pagination implementation

## Compatibility

- All logs are written to files, not output to console

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`pnpm test`)
5. Commit your changes (`git commit -m 'Add some amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

MIT
