# Quickstart: Ctrl-B Background Tool

## Overview
This feature allows users to move long-running foreground tools (like `bash` or `task`) to the background by pressing `Ctrl-B`.

## Usage

1. **Run a long command**:
   Ask the agent to run a long command, e.g., "Run a build that takes 2 minutes".
   
2. **Background it**:
   While the tool is running and showing output in the foreground, press `Ctrl-B`.
   
3. **Observe**:
   - The tool execution block will show "Command was manually backgrounded by user with ID task_XXX".
   - The agent will become available for new input immediately.
   - You can check the progress of the backgrounded task using the `/tasks` command.

## Limitations
- Direct bash commands (starting with `!`) cannot be backgrounded via `Ctrl-B`.
- Only tools that support backgrounding (`bash` and `task`) are affected.
