# File Selector Specification

The File Selector is an interactive UI component that allows users to quickly search for and select files or directories from the local filesystem to include in their input.

## Overview

The File Selector is triggered by typing the `@` character in the terminal input. It provides real-time filtering as the user continues to type, and allows for keyboard-based navigation and selection.

## Triggering and Activation

- **Trigger**: Typing `@` at any position in the input field.
- **Activation**: The `InputManager` detects the `@` character, records the cursor position (`atPosition`), and activates the `FileSelector` state.
- **Initial Search**: Upon activation, an initial search with an empty query is performed to show the files in the current working directory.

## Search and Filtering

- **Real-time Search**: As the user types after the `@` character, the `InputManager` updates the `fileSearchQuery`.
- **Debouncing**: File system searches are debounced (default 300ms) to prevent excessive I/O.
- **Backend**: The search is performed using the `searchFiles` utility from `wave-agent-sdk`.
- **Results**: The `FileSelector` component displays a list of matching files and directories, with icons (📁 for directories, 📄 for files).

## Navigation and Selection

- **Keyboard Navigation**:
  - `UpArrow` / `DownArrow`: Move the selection highlight.
  - `Enter` / `Tab`: Select the highlighted file/directory.
  - `Escape`: Cancel the selection and close the selector.
- **Selection Action**: When a file is selected, its path is inserted into the input text at the position where the `@` was typed, replacing the search query. A space is automatically added after the inserted path.
- **Cancellation**: The selector is closed if the user presses `Escape` or deletes the triggering `@` character.

## UI Components

- **FileSelector (Ink Component)**: Renders the list of files with a cyan border. It handles its own internal selection index and keyboard events for navigation.
- **Display Window**: If there are many results, the component shows a window of 10 items and indicates how many more items are above or below.
