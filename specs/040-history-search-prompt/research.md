# Research: History Search Prompt

## Decision: Use JSONL for History Storage
- **Rationale**: JSONL (JSON Lines) is ideal for append-only logs like command history. It allows adding new entries by simply appending a line, which is more efficient than reading, parsing, and rewriting a whole JSON array.
- **Alternatives considered**: 
    - **Standard JSON Array**: Easier to read the whole thing at once, but expensive to update as the history grows.
    - **SQLite**: Overkill for a simple prompt history.

## Decision: Remove Bash History Selector
- **Rationale**: The user explicitly asked to "remove bash history". The current `BashHistorySelector` is tied to `~/.wave/bash-history.json` and focuses on bash commands. Replacing it with a dedicated prompt history search provides a cleaner experience focused on agent interactions.
- **Alternatives considered**: 
    - **Merge histories**: Could have combined bash and prompt history, but the user's request was specific about removing bash history.

## Decision: Case-Insensitive Search
- **Rationale**: Most users expect history search to be case-insensitive for ease of use.
- **Alternatives considered**: 
    - **Case-sensitive**: Too restrictive.
    - **Smart-case**: Good, but case-insensitive is simpler and usually sufficient for this use case.

## Decision: Global History Scope
- **Rationale**: Users typically want to access prompts from previous sessions, not just the current one.
- **Alternatives considered**: 
    - **Session-only**: Less useful for long-term productivity.
