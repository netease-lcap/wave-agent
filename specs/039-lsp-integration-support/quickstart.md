# Quickstart: LSP Integration Support

LSP integration allows the Wave agent to use language servers for better code understanding.

## Configuration

To enable LSP support, create a `.lsp.json` file in your project root.

### Example: TypeScript
First, install the language server:
```bash
npm install -g typescript-language-server typescript
```

Then, add the following to `.lsp.json`:
```json
{
  "typescript": {
    "command": "typescript-language-server",
    "args": ["--stdio"],
    "extensionToLanguage": {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript"
    }
  }
}
```

## Using the LSP Tool

The agent can now use the `lsp` tool. You can also manually trigger it if needed (though usually the agent does this).

### Operations

- **Go to Definition**: Find where a function or variable is defined.
- **Hover**: Get type information and documentation.
- **Find References**: See all places where a symbol is used.
- **Document Symbols**: Get an overview of all classes and functions in the current file.
- **Call Hierarchy**: Explore what calls a function or what a function calls.

### Example Agent Prompt
"Find the definition of the `Agent` class and show me its constructor."
"What are the incoming calls for the `initialize` method in `lspManager.ts`?"

## Troubleshooting

- **Server not starting**: Ensure the `command` is in your PATH or provide an absolute path.
- **No results**: Make sure the file extension is correctly mapped in `extensionToLanguage`.
- **Logs**: Check the Wave logs for any LSP-related error messages.
