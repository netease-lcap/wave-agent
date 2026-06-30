# Research: Custom Tools via buildTool()

## Decision: buildTool() Factory Pattern

- **Rationale**: A factory function provides a clean, type-safe API for SDK users to define tools without needing to construct the full `ToolPlugin` interface manually. It auto-generates the `ChatCompletionFunctionTool` config, handles `prompt` string-to-function normalization, and sets sensible defaults. Inspired by Claude Code's `tool()` factory.
- **Alternatives considered**:
  - Require users to implement `ToolPlugin` directly: Rejected — too verbose, forces users to understand internal `config` structure.
  - MCP server approach: Already exists, but adds infrastructure overhead (separate process, stdio protocol). `buildTool()` is for in-process, lightweight custom tools.

## Decision: Register via Agent.create({ customTools })

- **Rationale**: Passing custom tools at `Agent.create()` time keeps them isolated from the SDK's built-in tool set. The `ToolManager` receives them via `ToolManagerOptions` and registers them alongside built-in tools in `initializeBuiltInTools()`. This matches the existing pattern for `mcpServers`, `plugins`, and `tools` whitelist.
- **Alternatives considered**:
  - Global registry / singleton: Rejected — breaks isolation, makes testing hard, conflicts with multiple Agent instances.
  - Post-creation registration method: Rejected — tools must be available before the first AI call; `Agent.create()` is the natural injection point.

## Decision: Respect Existing Permission & Whitelist System

- **Rationale**: Custom tools should behave identically to built-in tools regarding the `tools` whitelist, `allowedTools`, and `disallowedTools` permission rules. This means reusing `shouldEnableTool()` for custom tools, ensuring consistent behavior.
- **Alternatives considered**: Separate permission system for custom tools: Rejected — unnecessary complexity, confusing for users.

## Decision: TypeScript-Only Validation (No Runtime Checks)

- **Rationale**: `ToolDef` requires `name`, `description`, `parameters`, and `execute`. TypeScript's type system catches missing fields at compile time. SDK users are developers — runtime validation adds overhead without meaningful benefit.
- **Alternatives considered**: Runtime validation with Zod: Rejected — adds dependency, unnecessary for a developer-facing SDK.

## Integration Points

- `Agent.create()`: Accepts `customTools` in `AgentOptions`, passes to `setupAgentContainer`.
- `containerSetup.ts`: Passes `options.customTools` to `ToolManager` constructor.
- `ToolManager`: Stores `customTools`, registers them in `initializeBuiltInTools()` after built-in tools.
