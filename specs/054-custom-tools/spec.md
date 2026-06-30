# Feature Specification: Custom Tools via buildTool()

**Feature Branch**: `054-custom-tools`
**Created**: 2026-05-15

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Define Custom Tools with buildTool() (Priority: P1)

As an SDK user, I want to define custom tools using a simple `buildTool()` factory function so I can extend the agent's capabilities without writing MCP servers or modifying internal code.

**Why this priority**: This is the core API — without it, SDK users have no way to add custom tools beyond MCP servers.

**Independent Test**: Create a tool with `buildTool({ name, description, parameters, execute })`, pass it to `Agent.create({ customTools: [...] })`, send a message that triggers the tool, and verify the tool executes and returns results.

**Acceptance Scenarios**:

1. **Given** a custom tool defined via `buildTool()` with name, description, parameters, and execute function, **When** the tool is passed to `Agent.create({ customTools: [tool] })`, **Then** the tool appears alongside built-in tools and is callable by the model.
2. **Given** a tool with `required` parameters defined, **When** the model calls the tool, **Then** the tool's JSON schema correctly marks required fields.
3. **Given** a tool with a `prompt` string, **When** the agent retrieves tool configurations, **Then** the prompt is used as the tool description in the API call.

---

### User Story 2 - Advanced Tool Features (Priority: P2)

As an SDK user, I want advanced control over my custom tools (parameter formatting, dynamic prompts) so my tools integrate seamlessly with Wave's existing tool ecosystem.

**Why this priority**: These features allow custom tools to behave consistently with built-in tools regarding compact display and context-aware descriptions.

**Independent Test**: Create a tool with `formatCompactParams`, verify the compact representation appears in tool blocks. Create a tool with a dynamic `prompt` function, verify the description is context-aware.

**Acceptance Scenarios**:

1. **Given** a custom tool with `formatCompactParams`, **When** the tool executes, **Then** the UI displays the compact parameter representation in the tool block header.
2. **Given** a custom tool with `prompt` as a function, **When** tool descriptions are generated, **Then** the function is called with available subagents, skills, and workdir context.

---

### User Story 3 - Selective Tool Enablement (Priority: P2)

As an SDK user, I want to control which custom tools are enabled via the `tools` whitelist so I can selectively disable custom tools per session.

**Why this priority**: Custom tools should respect the same `tools` configuration as built-in tools, allowing fine-grained control.

**Independent Test**: Pass two custom tools to `Agent.create({ customTools: [toolA, toolB], tools: ["ToolA"] })`, verify only ToolA is registered and callable.

**Acceptance Scenarios**:

1. **Given** custom tools passed alongside a `tools` whitelist, **When** the agent initializes, **Then** only custom tools whose names appear in the whitelist are registered.
2. **Given** custom tools and a `disallowedTools` rule, **When** a custom tool matches a deny rule, **Then** the tool is not registered.

---

### Edge Cases

- **What happens if two custom tools have the same name?** The last one registered wins (same as built-in tool behavior with `toolsRegistry.set`).
- **What happens if a custom tool has the same name as a built-in tool?** The custom tool overwrites the built-in tool (intentional — allows SDK users to override built-in behavior).
- **What happens if `execute` throws an error?** The ToolManager's existing error handling catches it and returns `{ success: false, error: ... }`.
- **What happens if `buildTool()` is called with missing required fields (name, description, parameters, execute)?** TypeScript's type system prevents this at compile time; no runtime validation needed.
- **What happens if `customTools` is an empty array?** No custom tools are registered; behavior is identical to not passing `customTools`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST export a `buildTool()` factory function that accepts a `ToolDef` and returns a `ToolPlugin`.
- **FR-002**: `ToolDef` MUST include required fields: `name`, `description`, `parameters`, `execute`.
- **FR-003**: `ToolDef` MUST support optional fields: `required`, `prompt`, `formatCompactParams`, `additionalProperties`.
- **FR-004**: `buildTool()` MUST auto-construct a `ChatCompletionFunctionTool` config from the provided `name`, `description`, `parameters`, `required`, and `additionalProperties`.
- **FR-005**: When `prompt` is a string, `buildTool()` MUST normalize it to a zero-argument function returning that string.
- **FR-006**: `AgentOptions` MUST accept a `customTools?: ToolPlugin[]` field.
- **FR-007**: Custom tools MUST be registered in the `ToolManager` alongside built-in tools during `initializeBuiltInTools()`.
- **FR-008**: Custom tools MUST respect the `tools` whitelist — only custom tools whose names appear in the whitelist are enabled.
- **FR-009**: Custom tools MUST respect permission rules (`allowedTools`, `disallowedTools`).
- **FR-010**: `buildTool`, `ToolPlugin`, `ToolResult`, and `ToolContext` MUST be exported from the SDK's public API (`index.ts`).
- **FR-011**: Default values MUST be: `additionalProperties: false`.

### Key Entities

- **ToolDef**: User-facing interface for defining a custom tool's shape and behavior.
- **ToolPlugin**: Internal interface representing a registered tool (returned by `buildTool()`).
- **buildTool()**: Factory function converting `ToolDef` to `ToolPlugin`.
- **customTools**: Array of `ToolPlugin` passed to `Agent.create()` to register custom tools.
