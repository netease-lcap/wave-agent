# Quickstart: LSP Integration Support

## Overview
This feature enables advanced code intelligence for the agent using the Language Server Protocol (LSP).

## Development Setup
1. Install a language server (e.g., for TypeScript):
   ```bash
   npm install -g typescript-language-server typescript
   ```
2. Create a `.lsp.json` in your project root:
   ```json
   {
     "typescript": {
       "command": "typescript-language-server",
       "args": ["--stdio"],
       "extensionToLanguage": {
         ".ts": "typescript",
         ".tsx": "typescript"
       }
     }
   }
   ```
3. Build the `agent-sdk`:
   ```bash
   pnpm -F agent-sdk build
   ```

## Verification Steps

### Unit Tests
Run tests for the `LspManager` and `lsp` tool:
```bash
pnpm -F agent-sdk test tests/managers/lspManager.test.ts
pnpm -F agent-sdk test tests/tools/lspTool.test.ts
```

### Manual Verification
1. Start the agent in a project with `.lsp.json`.
2. Ask the agent: "Find the definition of the `Agent` class".
3. Verify the agent uses the `lsp` tool and correctly identifies the file and line number.
4. Ask: "What is the type of the `config` variable in `lspManager.ts`?"
5. Verify the agent uses the `hover` operation to get the type information.
