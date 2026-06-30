# Research: Tools Selection

## Decision: Implementation of `--tools` flag

The `--tools` flag will be implemented using `yargs` in `packages/code/src/index.ts`. It will accept a comma-separated list of tool names, which `yargs` will parse into a `string[]`. This list will be passed through the CLI components (`startCli`, `App`, `ChatProvider`) to the `Agent.create` method in `packages/agent-sdk`.

## Rationale

- **CLI Parsing**: `yargs` is already used for parsing other flags like `--plugins`, making it the natural choice for consistency.
- **SDK Integration**: Adding a `tools` property to `AgentOptions` allows the `Agent` to control tool availability at initialization.
- **Tool Management**: The `ToolManager` in `agent-sdk` is the central point for tool registration. Filtering built-in tools and plugins here ensures that the restriction is enforced at the core level.
- **User Experience**: Supporting `"default"` and `""` (empty string) provides clear ways to specify common configurations.

## Findings

### 1. CLI Argument Parsing
- **Location**: `packages/code/src/index.ts`
- **Mechanism**: `yargs` is used to define commands and options.
- **Current Flags**: `--plugins`, `--model`, `--log-level`, etc.

### 2. Agent Initialization (CLI)
- **Flow**: `index.ts` -> `cli.tsx` (`startCli`) -> `App.tsx` -> `useChat.tsx` (`ChatProvider`).
- **Agent Creation**: `ChatProvider` calls `Agent.create(options)`.

### 3. Agent SDK Tool Loading
- **Location**: `packages/agent-sdk/src/agent.ts` and `packages/agent-sdk/src/managers/toolManager.ts`.
- **Mechanism**: `Agent` initializes `ToolManager`, which calls `initializeBuiltInTools`.
- **Built-in Tools**: Bash, Glob, Grep, Read, Lsp, Edit, Write, Task, Skill.

### 4. Tool Representation
- **Default (All)**: `undefined` in SDK (maps from `"default"` or omitted flag in CLI).
- **None**: `[]` (empty array) in SDK (maps from `""` in CLI).
- **Specific**: `string[]` (e.g., `["Bash", "Read"]`) in SDK.

### 5. Tool Names
- Tool names are defined in their respective tool plugin objects (e.g., `bashTool.name` is "Bash").
- Comparison should be case-insensitive for user convenience but mapped to internal names.

## Alternatives Considered

- **Filtering in CLI**: Rejected because it would require the CLI to know about all built-in tools in the SDK, violating package boundaries.
- **New `PluginConfig` type**: Considered adding a "disabled" flag to plugins, but this wouldn't easily handle built-in tools which aren't loaded via the standard plugin mechanism.
- **Environment Variables**: Considered `WAVE_TOOLS`, but command-line flags are more explicit for per-session control.

## Research Tasks Completed
- [x] Research CLI parsing in `packages/code`.
- [x] Research agent initialization flow.
- [x] Research `agent-sdk` tool management.
- [x] Define tool representation in SDK.
- [x] Identify tool name constants.
