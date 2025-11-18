# Wave Agent

A monorepo containing AI-powered development tools built with Node.js and TypeScript.

## Project Structure

This is a monorepo that contains multiple packages working together to provide AI-assisted development tools through a command-line interface:

### 📦 Packages

#### [`packages/code`](./packages/code)

CLI-based code assistant with interactive terminal interface built with React Ink. Provides real-time chat with AI, file browsing, and session management.

- **Main Command**: `wave-code` or `wave` (short alias)
- **Technology**: Node.js, TypeScript, React Ink
- **Features**: Interactive CLI, file browser, AI chat, session restoration

#### [`packages/agent-sdk`](./packages/agent-sdk)

Core Node.js SDK providing AI services, tools, and utilities used by the CLI frontend.

- **Technology**: Node.js, TypeScript
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
