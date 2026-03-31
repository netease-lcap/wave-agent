# Contract: WebFetch Tool

**Branch**: `017-web-fetch-tool` | **Status**: Completed | **Date**: 2026-03-31 | **Spec**: [spec.md](../spec.md)

## Summary

The `WebFetch` tool is a plugin for the `wave-agent` that allows the AI agent to fetch and analyze web content. It is a read-only tool that converts HTML to Markdown and processes it with a fast AI model.

## Tool Definition

### Name

`WebFetch`

### Parameters

- **url**: The URL to fetch content from (string, required, format: uri).
- **prompt**: The prompt to run on the fetched content (string, required).

### Result

- **success**: Boolean indicating if the tool execution was successful.
- **content**: The AI model's response about the content.
- **error**: Optional error message if the tool execution failed.
- **shortResult**: Optional short result for summary display.

## Behavior

1. **Fetch**: The tool checks the cache for the requested URL.
2. **Network Request**: If the URL is not in the cache or the cache has expired, the tool makes a network request to fetch the HTML content.
3. **Conversion**: The HTML content is converted to Markdown using the `turndown` library.
4. **Cache Update**: The Markdown content is stored in the cache with the current timestamp.
5. **AI Processing**: The Markdown content is processed with the user-provided prompt using a specialized, lightweight `processWebContent` function and a fast AI model.
6. **Response**: The tool returns the AI model's response to the user.

## Error Handling

- **Network Errors**: The tool returns a success: false result with an appropriate error message.
- **Non-200 Status Codes**: The tool returns a success: false result with an appropriate error message.
- **Redirects**: If a URL redirects to a different host, the tool returns a message starting with `REDIRECT_TO: <url>`.
- **GitHub URLs**: The tool rejects GitHub URLs and suggests using the `gh` CLI.
- **Missing Parameters**: The tool returns a success: false result if `url` or `prompt` is missing.
