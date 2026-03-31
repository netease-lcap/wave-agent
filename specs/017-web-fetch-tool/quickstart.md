# Quickstart: WebFetch Tool

**Branch**: `017-web-fetch-tool` | **Status**: Completed | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)

## Summary

The `WebFetch` tool allows the AI agent to fetch and analyze web content. It is a read-only tool that converts HTML to Markdown and processes it with a fast AI model.

## Usage

### Basic Fetch

```json
{
  "url": "https://example.com",
  "prompt": "What is the title of this page?"
}
```

### Redirect Handling

If a URL redirects to a different host, the tool will return a message starting with `REDIRECT_TO: <url>`. You should then make a new `WebFetch` request with the redirect URL.

### GitHub URLs

For GitHub URLs, the tool will suggest using the `gh` CLI via the `Bash` tool.

## Configuration

The `WebFetch` tool uses the `fastModel` configuration from `AIManager` for AI processing.

## Testing

To test the `WebFetch` tool, run the following command:

```bash
pnpm -F wave-agent-sdk test tests/tools/webFetchTool.test.ts
```

## Constitution Check

1. **Package-First Architecture**: The tool is implemented as a plugin in `agent-sdk`.
2. **TypeScript Excellence**: The tool uses strict typing for parameters and results.
3. **Test Alignment**: Unit tests are provided for the tool's core logic.
4. **Build Dependencies**: `agent-sdk` must be built before use.
5. **Documentation Minimalism**: Only necessary documentation files are created.
6. **Quality Gates**: `type-check` and `lint` are required.
7. **Source Code Structure**: The tool is placed in the `tools` directory of `agent-sdk`.
8. **Data Model Minimalism**: A simple in-memory cache is used.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
