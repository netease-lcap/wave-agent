# Quickstart: btwAgent

The `btwAgent` feature allows you to ask quick questions about your codebase or current context without interrupting your main task or adding to the task queue. The `btwAgent` runs concurrently with the main agent, so you can query it while the main agent is busy with a long-running task. **Crucially, `/btw` commands bypass the main agent's message queue and are processed immediately, even if the main agent is busy.**

## How to Use

1.  **Ask a Question**: Type `/btw` followed by your question in the main input box.
    *   Example: `/btw what does this function do?`
    *   Example: `/btw how is the project structured?`

2.  **View the Response**: The UI will transition to the `btwAgent` mode. The main input box and the main message list will be hidden, and the `btwAgent` will generate a response based on the current conversation context. The main agent continues its work in the background.

3.  **Dismiss the Agent**: Once you have your answer, you can return to the main conversation by pressing any of the following keys:
    *   `Space`
    *   `Enter`
    *   `Escape`

## Key Features

- **Concurrent Execution**: The `btwAgent` and the main agent run at the same time.
- **Context-Aware**: The `btwAgent` inherits the current conversation history, so it knows what you've been working on.
- **Non-Intrusive**: It does not add tasks to the main agent's queue or modify the main conversation history.
- **Isolated**: It uses its own message and AI managers to ensure its state doesn't leak into the main agent's state.
- **Read-Only**: It has access to the same tools as the main agent but is instructed to provide a direct answer in a single response.

## Tips

- Use `/btw` for quick clarifications or exploration while the main agent is busy with a long-running task.
- The `btwAgent` is designed for one-off questions. If you need a more in-depth conversation, use the main agent.
