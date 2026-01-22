# Feature Specification: LSP Integration Support

**Feature Branch**: `039-lsp-integration-support`  
**Created**: 2025-12-24  
**Status**: Implemented  
**Input**: User description: "LSP (Language Server Protocol) integration allows Wave to provide advanced code intelligence features to the agent, such as finding definitions, references, and hover information."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Code Navigation (Priority: P1)

As an AI agent, I want to find the definition of a symbol so that I can understand how it is implemented without manually searching through files.

**Why this priority**: Fundamental for code understanding and navigation, especially in large codebases.

**Independent Test**: Call the `lsp` tool with the `goToDefinition` operation on a known symbol and verify it returns the correct file path and line number.

**Acceptance Scenarios**:

1. **Given** a valid symbol in a supported language, **When** the agent calls `goToDefinition`, **Then** the system MUST return the location (file and range) of the definition.
2. **Given** a symbol with multiple definitions (e.g., overloaded methods), **When** the agent calls `goToDefinition`, **Then** the system SHOULD return all relevant locations.

---

### User Story 2 - Type and Documentation Inspection (Priority: P1)

As an AI agent, I want to get hover information for a symbol so that I can see its type signature and documentation.

**Why this priority**: Helps the agent use APIs correctly and understand the purpose of variables and functions.

**Independent Test**: Call the `lsp` tool with the `hover` operation on a function and verify it returns the documentation string and type info.

**Acceptance Scenarios**:

1. **Given** a symbol with documentation, **When** the agent calls `hover`, **Then** the system MUST return the documentation and type information.

---

### User Story 3 - Call Hierarchy Exploration (Priority: P2)

As an AI agent, I want to see what functions call a specific method so that I can understand the impact of changing it.

**Why this priority**: Essential for refactoring and understanding the flow of execution.

**Independent Test**: Call `prepareCallHierarchy` followed by `incomingCalls` and verify it returns a list of caller functions.

**Acceptance Scenarios**:

1. **Given** a function that is called by other functions, **When** the agent calls `incomingCalls`, **Then** the system MUST return a list of all call sites.

---

### Edge Cases

- **No Server Configured**: If a file extension has no mapped LSP server, the tool should return a clear error.
- **Server Crash**: If the LSP server process dies, the `LspManager` should handle it gracefully and potentially restart it.
- **Large Responses**: Some LSP responses (like `findReferences`) can be very large; the tool should truncate or format them to fit within the agent's context.
- **Slow Servers**: Implement timeouts to prevent the agent from waiting indefinitely for a slow language server.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST load LSP configurations from `.lsp.json`.
- **FR-002**: System MUST manage the lifecycle of LSP server child processes.
- **FR-003**: System MUST implement JSON-RPC over stdio for communication with servers.
- **FR-004**: System MUST synchronize file state using `textDocument/didOpen`.
- **FR-005**: System MUST provide a built-in `lsp` tool for the agent.
- **FR-006**: System MUST support `goToDefinition`, `hover`, `findReferences`, `documentSymbol`, `workspaceSymbol`, `goToImplementation`, and call hierarchy operations.
- **FR-007**: System MUST convert LSP URIs to local file paths.
- **FR-008**: System MUST ensure all LSP processes are killed on agent shutdown.

### Key Entities *(include if feature involves data)*

- **LspManager**: Manages server processes and communication.
- **LspTool**: The agent-facing tool interface.
- **LspServerConfig**: Configuration for a specific language server.
- **LspProcess**: Internal state of a running server.

## Assumptions

- The user has the necessary language server executables installed on their system.
- The project contains a `.lsp.json` file if custom LSP servers are needed.
- The terminal environment allows spawning child processes.
