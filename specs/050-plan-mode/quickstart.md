# Quickstart: Support Plan Mode

## Overview
Plan Mode allows you to safely analyze your codebase and build a plan without making any changes to your files or running commands.

## How to use

1. **Switch to plan mode**: Press `Shift+Tab` until you see "plan" in the UI.
2. **Observe Plan File Path**: A new plan file path with a random name (e.g., `~/.wave/plans/gentle-breeze.md`) will be determined.
3. **Ask the system to Plan**: The system will now be able to read your files and will start building the plan by writing to the designated plan file.
4. **Review the Plan**: You can open the plan file to see the progress as it incrementally updates the file.
5. **Switch back**: Press `Shift+Tab` to return to "default" mode when you are ready to implement the plan.

## Restrictions in plan mode
- **Read-only**: The system can read any file but cannot edit them.
- **No Commands**: The system cannot run any bash commands.
- **Plan File Exception**: The system can only edit the designated plan file in `~/.wave/plans/`.
