# Research: WebFetch Tool

**Branch**: `017-web-fetch-tool` | **Status**: Completed | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)

## Summary

The `WebFetch` tool is designed to provide a simple way for the AI agent to access and analyze web content. It uses the Node.js built-in `fetch` API for network requests and the `turndown` library for HTML to Markdown conversion. The tool is read-only and does not modify any files. It includes a 15-minute cache for faster responses when repeatedly accessing the same URL.

## Technical Context

- **Fetch API**: Node.js 18+ includes a built-in `fetch` API that is compatible with the browser's `fetch`.
- **Turndown**: A popular library for converting HTML to Markdown. It is lightweight and easy to use.
- **AI Processing**: The tool uses a specialized `processWebContent` function in `aiService` (similar to `compressMessages`) to process the extracted Markdown content with a user-provided prompt. This bypasses the full Agent infrastructure for better performance and stability.
- **Redirect Handling**: The tool uses the `redirect: 'manual'` option in `fetch` to detect redirects and check if the host has changed.
- **GitHub URLs**: GitHub content is often better accessed via the `gh` CLI, which handles authentication and structured data better than a generic web fetcher.

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
