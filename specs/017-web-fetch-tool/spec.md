# Feature Specification: WebFetch Tool

**Feature Branch**: `017-web-fetch-tool`  
**Created**: 2026-03-31  
**Updated**: 2026-04-21  
**Input**: User description: "support WebFetch tool, fetches content from a specified URL and processes it using an AI model. Takes a URL and a prompt as input. Fetches the URL content, converts HTML to markdown. Processes the content with the prompt using a small, fast model. Returns the model's response about the content. Includes a self-cleaning 15-minute cache. Handles redirects to different hosts by informing the user. Suggests gh CLI for GitHub URLs."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Basic Web Content Extraction (Priority: P1)

As a user, I want to be able to fetch content from a URL and ask questions about it, so that I can quickly get information from web pages without leaving the terminal.

**Why this priority**: This is the core functionality of the tool.

**Independent Test**: Can be tested by calling the `WebFetch` tool with a simple URL and a prompt, and verifying that the tool returns a relevant response based on the page content.

**Acceptance Scenarios**:

1. **Given** a URL `https://example.com` and a prompt "What is the title of this page?", **When** the `WebFetch` tool is executed, **Then** it should return a response containing "Example Domain".
2. **Given** a URL that is not reachable, **When** the `WebFetch` tool is executed, **Then** it should return a success: false result with an appropriate error message.

---

### User Story 2 - Redirect Handling (Priority: P2)

As a user, I want to be informed when a URL redirects to a different host, and to have same-host redirects followed automatically, so that I don't need to manually re-fetch for every redirect.

**Why this priority**: This ensures transparency and security when accessing web content while reducing unnecessary tool calls.

**Acceptance Scenarios**:

1. **Given** a URL `http://short.url` that redirects to `https://another-domain.com/page`, **When** the `WebFetch` tool is executed, **Then** it should return a message starting with `REDIRECT_TO: https://another-domain.com/page` and inform the user about the host change.
2. **Given** a URL that redirects to the same host with a different path, **When** the `WebFetch` tool is executed, **Then** it should follow the redirect automatically and return the page content without a `REDIRECT_TO` message.
3. **Given** a URL that redirects from `example.com` to `www.example.com`, **When** the `WebFetch` tool is executed, **Then** it should follow the redirect automatically.

---

### User Story 3 - GitHub URL Handling (Priority: P2)

As a user, I want to be suggested to use the `gh` CLI when I try to fetch a GitHub URL, so that I can use more specialized and authenticated tools for GitHub content.

**Why this priority**: GitHub content is often better accessed via its official CLI which handles authentication and structured data better than a generic web fetcher.

**Acceptance Scenarios**:

1. **Given** a GitHub URL `https://github.com/netease-lcap/wave-agent`, **When** the `WebFetch` tool is executed, **Then** it should return an error message suggesting the use of the `gh` CLI via the `Bash` tool.

---

### User Story 4 - Caching (Priority: P3)

As a user, I want repeated requests to the same URL to be fast, so that I don't waste time and tokens re-fetching and re-processing the same content.

**Why this priority**: Improves performance and reduces resource usage.

**Acceptance Scenarios**:

1. **Given** a URL has been fetched once, **When** it is fetched again within 15 minutes with the same or different prompt, **Then** the tool should use the cached Markdown content instead of making a new network request.

---

### User Story 5 - Security & Robustness (Priority: P2)

As a user, I want the tool to protect against excessive resource usage and provide clear error messages, so that I don't experience hangs or memory issues.

**Why this priority**: Prevents the tool from consuming excessive resources or hanging indefinitely.

**Acceptance Scenarios**:

1. **Given** a URL exceeding 2000 characters, **When** the `WebFetch` tool is executed, **Then** it should return an error about URL length.
2. **Given** a URL with username/password credentials, **When** the `WebFetch` tool is executed, **Then** it should reject the URL.
3. **Given** a `localhost` URL, **When** the `WebFetch` tool is executed, **Then** it should reject the URL.
4. **Given** a response exceeding 10MB, **When** the `WebFetch` tool is executed, **Then** it should reject the response.
5. **Given** a fetch that takes longer than 60 seconds, **When** the timeout is reached, **Then** the request should be aborted.
6. **Given** a redirect loop, **When** the redirect count exceeds 10, **Then** the tool should return an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `WebFetch` tool.
- **FR-002**: System MUST accept `url` and `prompt` as parameters.
- **FR-003**: System MUST upgrade `http://` URLs to `https://`.
- **FR-004**: System MUST fetch the content of the URL using a standard HTTP client.
- **FR-005**: System MUST convert the fetched HTML content to Markdown.
- **FR-006**: System MUST process the Markdown content with the provided prompt using a "fast" AI model.
- **FR-007**: System MUST implement a 15-minute LRU cache for fetched Markdown content with a 50MB size limit.
- **FR-008**: System MUST detect redirects to different hosts and return a `REDIRECT_TO: <url>` message. Same-host and `www.`-variation redirects MUST be followed automatically (max 10 hops).
- **FR-009**: System MUST reject GitHub URLs and suggest using the `gh` CLI.
- **FR-010**: System MUST handle network errors and non-200 status codes gracefully.
- **FR-011**: System MUST validate URLs: max 2000 chars, no username/password, hostname must have ≥2 parts.
- **FR-012**: System MUST enforce a 10MB content length limit and 60-second fetch timeout.
- **FR-013**: System MUST truncate Markdown content exceeding 100,000 characters before AI processing.
- **FR-014**: System MUST include an honest User-Agent header (`Wave-User (+https://github.com/netease-lcap/wave-agent)`) and Accept header (`text/markdown, text/html, */*`).

### Non-Functional Requirements

- **NFR-001**: The tool MUST be read-only and not modify any files.
- **NFR-002**: The tool MUST be fast and efficient.
- **NFR-003**: The tool MUST handle large content by truncating and summarizing if necessary.
- **NFR-004**: The tool MUST provide clear error messages and diagnostic output (HTTP status code, content size).
- **NFR-005**: The cache MUST use an LRU eviction strategy with automatic expiration (no manual cleanup interval).

### Key Entities *(include if feature involves data)*

- **WebFetch Cache**: An LRU cache for Markdown content indexed by URL, with a TTL of 15 minutes and a 50MB max size limit. Each entry stores: `{ bytes, code, codeText, content, contentType }`.
- **Markdown Content**: The result of converting HTML to a simplified text format for AI processing. Content exceeding 100,000 characters is truncated.
