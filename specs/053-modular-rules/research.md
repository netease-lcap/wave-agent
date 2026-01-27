# Research: Modular Rules

## Decision: Rule Loading and Discovery
- **Decision**: Implement a `RuleManager` in `packages/agent-sdk/src/managers/RuleManager.ts` that handles discovery and lifecycle of rules.
- **Rationale**: Following the existing manager pattern in `agent-sdk` (like `MessageManager`, `ToolManager`) ensures consistency and clear separation of concerns.
- **Alternatives considered**: Adding logic directly to `Agent.ts` or `memory.ts`, but this would violate the single responsibility principle and make the code harder to maintain.

## Decision: YAML Frontmatter Parsing
- **Decision**: Use `js-yaml` for parsing YAML frontmatter.
- **Rationale**: `js-yaml` is a standard, reliable library for YAML parsing in Node.js. Although not currently a direct dependency of `agent-sdk`, it is widely used and lightweight.
- **Alternatives considered**: Manual regex parsing (error-prone) or `gray-matter` (adds more dependencies than needed).

## Decision: Glob Matching
- **Decision**: Use `picomatch` or `micromatch` for glob matching.
- **Rationale**: These libraries are highly performant and support advanced features like brace expansion (`{src,lib}/**/*.ts`) required by the spec. `glob` is already a dependency of `agent-sdk`, but `picomatch` is often preferred for in-memory string matching.
- **Alternatives considered**: `minimatch` (already a dependency, but `picomatch` is generally faster).

## Decision: Symlink and Circularity Handling
- **Decision**: Use `fs.promises.realpath` to resolve symlinks and maintain a `Set` of visited paths to detect circularity.
- **Rationale**: Standard Node.js `fs` APIs are sufficient for this. A `Set` of real paths provides an efficient way to detect loops during recursive (or subdirectory) discovery.
- **Alternatives considered**: Third-party libraries for symlink traversal, but they are unnecessary for this scope.

## Decision: Context Window Integration
- **Decision**: Integrate rule activation into `AIManager.sendAIMessage`.
- **Rationale**: This is where the system prompt is built and where the "context" (messages, memory) is consolidated before calling the AI service. By checking the files in the current `MessageManager` state, we can dynamically inject applicable rules into the system prompt.
- **Alternatives considered**: Activating rules at the `ToolManager` level, but rules are meant to guide the agent's overall behavior, not just tool execution.

## Decision: Rule Discovery Scope
- **Decision**: Limit discovery to `.wave/rules/` and its immediate subdirectories (non-recursive beyond one level).
- **Rationale**: Directly requested by the user to keep discovery predictable and avoid performance issues with deep directory structures.
- **Alternatives considered**: Fully recursive discovery (rejected by user).
