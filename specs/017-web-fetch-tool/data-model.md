# Data Model: WebFetch Tool

**Branch**: `017-web-fetch-tool` | **Status**: Completed | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)

## Summary

The `WebFetch` tool uses a simple in-memory cache to store the Markdown content of fetched URLs. This cache is implemented as a `Map` with a TTL of 15 minutes.

## Entities

### WebFetchCache

- **url**: The URL of the fetched content (string, key).
- **content**: The Markdown content of the page (string).
- **timestamp**: The time when the content was fetched (number).

## Relationships

- **WebFetchCache** is a collection of cached Markdown content indexed by URL.

## Data Flow

1. **Fetch**: The tool checks the cache for the requested URL.
2. **Network Request**: If the URL is not in the cache or the cache has expired, the tool makes a network request to fetch the HTML content.
3. **Conversion**: The HTML content is converted to Markdown using the `turndown` library.
4. **Cache Update**: The Markdown content is stored in the cache with the current timestamp.
5. **AI Processing**: The Markdown content is processed with the user-provided prompt using a fast AI model.
6. **Response**: The tool returns the AI model's response to the user.

## Constitution Check

1. **Package-First Architecture**: The data model is implemented in `agent-sdk`.
2. **TypeScript Excellence**: The cache is strictly typed.
3. **Test Alignment**: The cache logic is tested as part of the tool's unit tests.
4. **Build Dependencies**: `agent-sdk` must be built before use.
5. **Documentation Minimalism**: Only necessary documentation files are created.
6. **Quality Gates**: `type-check` and `lint` are required.
7. **Source Code Structure**: The cache is implemented within the `webFetchTool.ts` file.
8. **Data Model Minimalism**: A simple in-memory cache is used.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
