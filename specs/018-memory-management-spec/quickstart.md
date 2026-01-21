# Memory Management Quickstart

## How to Save Memory

1.  **Type**: Start your message with `#`.
    - Example: `# Always use functional components in React`
2.  **Submit**: Press `Enter`.
3.  **Choose**: A selector will appear. Choose **Project** to save it to the local `AGENTS.md`, or **User** to save it globally.
4.  **Verify**: You can open `AGENTS.md` in your project or the global memory file to see the new entry.

## How the Agent Uses Memory

You don't need to do anything for the agent to use the memory. Every time you send a message:
1.  The agent reads your project's `AGENTS.md`.
2.  The agent reads your global user memory.
3.  It combines them and reminds itself of these rules before answering.

## Example Scenario

- **User**: `# My name is Alice` (Saves to **User** memory)
- **User**: `# This project uses Tailwind CSS` (Saves to **Project** memory)
- **Later**: When you ask the agent to build a UI, it will know your name is Alice and that it should use Tailwind CSS for this specific project.
