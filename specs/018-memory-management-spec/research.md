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
