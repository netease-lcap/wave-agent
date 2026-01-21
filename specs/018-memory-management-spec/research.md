# Memory Management Research

## Current Implementation Analysis

- **File-Based**: The system is entirely file-based, using `fs.readFile` and `fs.writeFile`. This is simple and transparent but may not scale well to thousands of entries.
- **No Deduplication**: Currently, the system appends every `#` message. If a user saves the same fact twice, it will appear twice in the memory file.
- **Full Read**: The entire memory content is read and sent to the AI for every request. This consumes tokens and may eventually hit context limits if the memory files grow very large.

## Observations

- **Transparency**: Users can easily edit `AGENTS.md` or the user memory file manually to add, remove, or correct information.
- **Simplicity**: The `#` trigger is easy to remember and use.
- **Separation of Concerns**: The distinction between project and user memory is well-implemented and provides the right level of context.

## Potential Improvements

- **Vector Search (RAG)**: Instead of sending the *entire* memory, use vector embeddings to retrieve only the most relevant memory entries for the current conversation.
- **Memory Editing UI**: Provide a way to view and delete memory entries directly within the terminal UI.
- **Automatic Memory**: Allow the agent to suggest saving information to memory when it detects a recurring pattern or an explicit instruction in a normal message.
- **Categorization**: Support tags or categories (e.g., `#style: use tabs`) to better organize memory.
