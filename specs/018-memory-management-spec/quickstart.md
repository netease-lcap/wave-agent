# Quickstart: Memory Management

## Overview
This feature adds a Memory Management system triggered by `#` to persist information across conversations.

## Development Setup
1. Build the `agent-sdk` to include the memory service:
   ```bash
   pnpm -F agent-sdk build
   ```
2. Run the CLI to test memory saving:
   ```bash
   pnpm -F code start
   ```

## Verification Steps

### Unit Tests
Run tests for the memory service and selector component:
```bash
pnpm -F agent-sdk test tests/services/memory.test.ts
pnpm -F code test tests/components/MemoryTypeSelector.test.tsx
```

### Manual Verification
1. Start the agent.
2. Type `# Use pnpm instead of npm` and press `Enter`.
3. Select "Project" memory in the UI.
4. Verify `AGENTS.md` is created/updated in the current directory.
5. Ask the agent "What package manager should I use?" and verify it mentions pnpm.
