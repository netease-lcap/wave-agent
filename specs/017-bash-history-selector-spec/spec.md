# Bash History Selector Specification

The Bash History Selector is an interactive UI component that allows users to search, select, and execute commands from their bash history directly within the terminal input.

## Overview

The Bash History Selector is triggered by typing the `!` character at the beginning of the input field. It provides a searchable list of previously executed commands, allowing for quick re-execution or modification.

## Triggering and Activation

- **Trigger**: Typing `!` as the first character of the input.
- **Activation**: The `InputManager` detects the `!` at position 0 and activates the `BashHistorySelector` state.
- **Initial State**: The selector opens and displays the most recent history entries.

## Search and Filtering

- **Real-time Search**: As the user types after the `!`, the `InputManager` updates the `bashHistorySearchQuery`.
- **Backend**: The `BashHistorySelector` component uses the `searchBashHistory` utility from `wave-agent-sdk` to fetch matching entries.
- **Filtering**: The search is typically performed on the command string and can be filtered by the current working directory.

## Navigation and Actions

- **Keyboard Navigation**:
  - `UpArrow` / `DownArrow`: Move the selection highlight.
  - `Enter`: Execute the highlighted command immediately.
  - `Tab`: Insert the highlighted command into the input field for editing (without executing).
  - `Ctrl+d`: Delete the highlighted command from the history.
  - `Escape`: Cancel and close the selector.
- **Execution**: When a command is executed via `Enter`, the input field is cleared, and the command is sent to the agent (prefixed with `!` to indicate bash execution).
- **Insertion**: When a command is selected via `Tab`, it replaces the `!query` in the input field, allowing the user to modify it before running.

## UI Components

- **BashHistorySelector (Ink Component)**: Renders the list of history entries with a blue border.
- **Metadata**: For the selected item, it displays additional information such as the timestamp and the directory where the command was originally executed.
