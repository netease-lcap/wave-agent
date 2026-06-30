# Research: Memory Management

**Decision**: Implement a dual-layer memory system (Project and User) triggered by the `#` character.

**Rationale**: 
- Agents need persistent context to be effective over long-term projects.
- Distinguishing between project-specific and user-global memory provides better control over context sharing.
- Using Markdown files for storage ensures transparency and allows users to edit memory manually.

**Alternatives Considered**:
- **Database Storage**: Rejected in favor of simple Markdown files for better portability and user visibility.
- **Automatic Memory**: Automatically saving everything the agent learns was rejected to avoid cluttering the context with irrelevant information; explicit saving via `#` is preferred.

## Findings

### Trigger Logic
- The `#` character is commonly used for tagging or notes.
- Submitting a message starting with `#` should trigger the storage type selection.

### Storage Strategy
- **Project Memory**: `AGENTS.md` in the project root. This file can be committed to version control.
- **User Memory**: A global file in `~/.wave/memory.md` for cross-project preferences.
- **Format**: Simple Markdown bullet points for easy parsing and human readability.

### Retrieval Strategy
- Combine both memory files into a single context block.
- Inject this block into the system prompt of every AI request.
- For very large memory files, consider future RAG (Retrieval-Augmented Generation) implementations.

### Integration Points
- **InputManager**: Detect the `#` trigger and show the `MemoryTypeSelector`.
- **Memory Service**: Handle reading from and writing to the Markdown files.
- **AIManager**: Orchestrate the inclusion of memory in the AI's context.

---

## Research: Reference Implementation (Claude Code)

### Path-Specific Rule Handling
Claude Code implements modular memory rules (e.g., `.claude/rules/*.md`) using an event-driven trigger system rather than scanning the entire context window.

#### Key Findings:
1.  **Trigger-Based Activation**:
    - Instead of iterating over every message in the context window to find file paths, the system uses a `nestedMemoryAttachmentTriggers` set.
    - This set is populated whenever a file is "touched" via:
        - **Tool Use**: `FileReadTool` calls add the target file path to the trigger set.
        - **User Input**: Explicit file mentions (e.g., `@src/main.ts`) add the path to the trigger set.
2.  **Incremental Loading**:
    - During each turn's attachment phase, the system processes only the paths in the trigger set.
    - It walks up the directory tree from the "touched" file to the project root, looking for applicable rule files.
3.  **Deduplication**:
    - A session-persistent set (`loadedNestedMemoryPaths`) tracks which rules have already been attached to the conversation.
    - Rules are attached as messages in the transcript, ensuring they stay in context without redundant re-injection.
4.  **Compaction Resilience**:
    - When the conversation is compacted (summarized), the deduplication set is cleared.
    - The system then re-triggers rules for the "active" files restored post-compaction, ensuring the new context remains guided by relevant rules.
5.  **Efficiency**:
    - This design avoids O(n) scans of the message history.
    - File I/O and glob matching only occur when new files enter the active working set.

### Decision: MemoryRule Loading and Discovery
- **Decision**: Implement a `MemoryRuleManager` in `packages/agent-sdk/src/managers/MemoryRuleManager.ts` that handles discovery and lifecycle of memory rules.
- **Rationale**: Following the existing manager pattern in `agent-sdk` (like `MessageManager`, `ToolManager`) ensures consistency and clear separation of concerns.
- **Alternatives considered**: Adding logic directly to `Agent.ts` or `memory.ts`, but this would violate the single responsibility principle and make the code harder to maintain.

### Decision: YAML Frontmatter Parsing
- **Decision**: Use the existing `parseFrontmatter` utility in `packages/agent-sdk/src/utils/markdownParser.ts` for parsing YAML frontmatter.
- **Rationale**: The project already has a lightweight, custom YAML parser specifically designed for Markdown frontmatter. Reusing it avoids adding new dependencies like `js-yaml`.
- **Alternatives considered**: `js-yaml` (rejected to avoid new dependencies).

### Decision: Glob Matching
- **Decision**: Use `minimatch` for glob matching.
- **Rationale**: `minimatch` is already a direct dependency of `agent-sdk` and supports the required glob features, including brace expansion. Using an existing dependency keeps the package lean.
- **Alternatives considered**: `picomatch` or `micromatch` (rejected to avoid adding new dependencies).

### Decision: Symlink and Circularity Handling
- **Decision**: Use `fs.promises.realpath` to resolve symlinks and maintain a `Set` of visited paths to detect circularity.
- **Rationale**: Standard Node.js `fs` APIs are sufficient for this. A `Set` of real paths provides an efficient way to detect loops during subdirectory discovery.
- **Alternatives considered**: Third-party libraries for symlink traversal, but they are unnecessary for this scope.

### Decision: Path-Specific Rule Activation
- **Decision**: Use an event-driven trigger system to activate path-specific rules instead of iterating over all messages in the context window.
- **Rationale**: Iterating over the entire context window (messages) to detect file paths is inefficient (O(n) per turn). Instead, the system should track "active" files as they enter the context.
- **Implementation**:
    - Maintain a `filesInContext` set in the `MessageManager` or `ToolUseContext`.
    - Populate this set whenever a file is "touched":
        1. **Tool Use**: When `FileReadTool` or `FileEditTool` is called.
        2. **User Input**: When a file is explicitly mentioned (e.g., via `@filename` or similar triggers).
    - During prompt construction, `MemoryRuleManager` matches rules against this set of active files.
    - Use a session-persistent set to ensure each rule is attached only once per session (deduplication).
    - Clear the deduplication set during conversation compaction to allow relevant rules to be re-injected into the new context.
- **Reference**: This approach is inspired by Claude Code's `nestedMemoryAttachmentTriggers` and `loadedNestedMemoryPaths` mechanism.

### Decision: MemoryRule Discovery Scope
- **Decision**: Limit discovery to `.wave/rules/` and its immediate subdirectories (non-recursive beyond one level).
- **Rationale**: Directly requested by the user to keep discovery predictable and avoid performance issues with deep directory structures.
- **Alternatives considered**: Fully recursive discovery (rejected by user).
