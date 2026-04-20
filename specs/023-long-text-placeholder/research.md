# Research: Long Text Placeholder

**Decision**: Implement input compression via placeholders for long pasted text.

**Rationale**: 
- Pasting large blocks of text (e.g., logs or code) makes the terminal input unusable; placeholders solve this.
- Improves the user experience by keeping the input field clean and manageable.

**Alternatives Considered**:
- **Truncation**: Simply cutting off long text. Rejected because it leads to loss of user input.
- **Collapsible UI**: Making the input field collapsible. Rejected as too complex for the initial CLI implementation.

## Findings

### Input Compression
- **Trigger**: 200-character threshold for paste events.
- **Placeholder**: `[LongText#ID]` is used as it's unlikely to occur naturally in user input.
- **Expansion**: Must happen just before the message is sent to ensure the agent receives the full content.

### Integration Points
- **InputManager**: Manages the `longTextMap` and placeholder replacement.
- **PromptHistoryManager**: Preserves placeholders and their mappings in history.

### Paste Chunking Issue
Terminal paste events fire multiple keyboard events in rapid succession.
React batches state updates asynchronously, so `state.isPasting` can be stale
when subsequent chunks arrive. The handler would dispatch `START_PASTE` instead
of `APPEND_PASTE_BUFFER`, overwriting the buffer.

**Solution**: Replace the two-action pattern (`START_PASTE` / `APPEND_PASTE_BUFFER`)
with a single `APPEND_PASTE_CHUNK` action. The reducer determines start vs append
by checking if `pasteBuffer` is empty. Since `useReducer` processes dispatches
sequentially, each dispatch sees the result of the previous one, ensuring
all chunks accumulate correctly.
