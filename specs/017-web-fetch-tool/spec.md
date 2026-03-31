# Feature Specification: WebFetch Tool

**Feature Branch**: `017-web-fetch-tool`  
**Created**: 2026-03-31  
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

As a user, I want to be informed when a URL redirects to a different host, so that I can decide whether to follow the redirect or not.

**Why this priority**: This ensures transparency and security when accessing web content.

**Acceptance Scenarios**:

1. **Given** a URL `http://short.url` that redirects to `https://another-domain.com/page`, **When** the `WebFetch` tool is executed, **Then** it should return a message starting with `REDIRECT_TO: https://another-domain.com/page` and inform the user about the host change.

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

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `WebFetch` tool.
- **FR-002**: System MUST accept `url` and `prompt` as parameters.
- **FR-003**: System MUST upgrade `http://` URLs to `https://`.
- **FR-004**: System MUST fetch the content of the URL using a standard HTTP client.
- **FR-005**: System MUST convert the fetched HTML content to Markdown.
- **FR-006**: System MUST process the Markdown content with the provided prompt using a "fast" AI model.
- **FR-007**: System MUST implement a 15-minute self-cleaning cache for fetched Markdown content.
- **FR-008**: System MUST detect redirects to different hosts and return a `REDIRECT_TO: <url>` message.
- **FR-009**: System MUST reject GitHub URLs and suggest using the `gh` CLI.
- **FR-010**: System MUST handle network errors and non-200 status codes gracefully.

### Key Entities *(include if feature involves data)*

- **WebFetch Cache**: An in-memory store for Markdown content indexed by URL, with a TTL of 15 minutes.
- **Markdown Content**: The result of converting HTML to a simplified text format for AI processing.
