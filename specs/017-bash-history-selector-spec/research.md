# Bash History Selector Research

## Current Implementation Analysis

- **Trigger**: Strictly limited to `!` at the very beginning of the input (`cursorPosition === 1`).
- **Search**: Uses `searchBashHistory` from `wave-agent-sdk`. It currently returns a limited number of results (default 10).
- **Deletion**: Supports removing entries from history via `deleteBashCommandFromHistory`. This is useful for cleaning up sensitive or incorrect commands.
- **Context**: The selector shows the working directory for each command, helping users distinguish between similar commands run in different projects.

## Observations

- **Execution vs. Insertion**: The distinction between `Enter` (run) and `Tab` (edit) is a powerful feature for power users.
- **Empty State**: If no history matches, the selector allows the user to execute the current search query as a new command.

## Potential Improvements

- **Global vs. Local History**: Option to toggle between history for the current project and global history.
- **Frequency Ranking**: Rank results by how often they are used, not just by recency.
- **Multi-line Commands**: Better handling and display of multi-line bash commands.
