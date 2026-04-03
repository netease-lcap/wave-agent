# Wave Agent

A monorepo containing AI-powered development tools built with Node.js and TypeScript.

## Project Structure

This is a monorepo that contains multiple packages working together to provide AI-assisted development tools through a command-line interface:

### 📦 Packages

#### [`packages/code`](./packages/code)

CLI-based code assistant with interactive terminal interface built with React Ink. Similar to **Claude Code**.

- **Main Command**: `wave-code` or `wave` (short alias)
- **Technology**: Node.js, TypeScript, React Ink

#### [`packages/agent-sdk`](./packages/agent-sdk)

Core Node.js SDK used by the CLI frontend. Similar to **Claude Agent SDK**.

- **Technology**: Node.js, TypeScript

### 📄 Specifications

Detailed feature specifications and design documents can be found in the [`specs/`](./specs) directory.

## Development

### Prerequisites

- Node.js 22+
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
