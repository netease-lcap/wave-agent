# Research: Modular Memory Rules

## Decision: MemoryRule Loading and Discovery
- **Decision**: Implement a `MemoryRuleManager` in `packages/agent-sdk/src/managers/MemoryRuleManager.ts` that handles discovery and lifecycle of memory rules.
- **Rationale**: Following the existing manager pattern in `agent-sdk` (like `MessageManager`, `ToolManager`) ensures consistency and clear separation of concerns.
- **Alternatives considered**: Adding logic directly to `Agent.ts` or `memory.ts`, but this would violate the single responsibility principle and make the code harder to maintain.

## Decision: YAML Frontmatter Parsing
- **Decision**: Use the existing `parseFrontmatter` utility in `packages/agent-sdk/src/utils/markdownParser.ts` for parsing YAML frontmatter.
- **Rationale**: The project already has a lightweight, custom YAML parser specifically designed for Markdown frontmatter. Reusing it avoids adding new dependencies like `js-yaml`.
- **Alternatives considered**: `js-yaml` (rejected to avoid new dependencies).

## Decision: Glob Matching
- **Decision**: Use `minimatch` for glob matching.
- **Rationale**: `minimatch` is already a direct dependency of `agent-sdk` and supports the required glob features, including brace expansion. Using an existing dependency keeps the package lean.
- **Alternatives considered**: `picomatch` or `micromatch` (rejected to avoid adding new dependencies).

## Decision: Symlink and Circularity Handling
- **Decision**: Use `fs.promises.realpath` to resolve symlinks and maintain a `Set` of visited paths to detect circularity.
- **Rationale**: Standard Node.js `fs` APIs are sufficient for this. A `Set` of real paths provides an efficient way to detect loops during subdirectory discovery.
- **Alternatives considered**: Third-party libraries for symlink traversal, but they are unnecessary for this scope.

## Decision: Context Window Integration
- **Decision**: Integrate memory rule activation into `AIManager.sendAIMessage`.
- **Rationale**: This is where the system prompt is built and where the "context" (messages, memory) is consolidated before calling the AI service. By checking the files in the current `MessageManager` state, we can dynamically inject applicable memory rules into the system prompt.
- **Alternatives considered**: Activating memory rules at the `ToolManager` level, but memory rules are meant to guide the agent's overall behavior, not just tool execution.

## Decision: MemoryRule Discovery Scope
- **Decision**: Limit discovery to `.wave/rules/` and its immediate subdirectories (non-recursive beyond one level).
- **Rationale**: Directly requested by the user to keep discovery predictable and avoid performance issues with deep directory structures.
- **Alternatives considered**: Fully recursive discovery (rejected by user).
