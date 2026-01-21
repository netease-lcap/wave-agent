# Message Compression Plan

## Phase 1: Maintenance and Stability
- Ensure `DEFAULT_KEEP_LAST_MESSAGES_COUNT` is appropriately tuned for different models.
- Verify that images are handled correctly during compression (currently they are counted as blocks but their content might be lost in the summary if not explicitly handled by the summarization prompt).

## Phase 2: Enhancements
- Implement configurable threshold for input compression.
- Add "Expand/Collapse" toggle for long text in the UI if possible.

## Phase 3: Optimization
- Optimize the summarization prompt to ensure no critical information (like file paths or specific tool results) is lost.
- Consider using a cheaper/faster model specifically for summarization tasks.
