# Quickstart: /btw Side Question

The `/btw` command allows you to ask quick, side questions without interrupting the main agent's current task. This is useful for getting information, checking documentation, or asking for clarifications while a long-running task (like building or testing) is in progress.

## How to Use

1. **Start a task**: Begin any task with the main agent as usual.
2. **Ask a side question**: While the main agent is working, type `/btw` followed by your question in the input field.
   ```text
   /btw how do I use the Grep tool?
   ```
3. **View the answer**: The message list will automatically switch to show the side agent's response.
4. **Ask follow-up questions**: You can continue the conversation with the side agent by typing more messages in the input field while the side view is active.
5. **Dismiss the side view**: Once you have your answer, press the **Escape** key to return to the main conversation. The main agent will have continued its work in the background.

## Key Features

- **Non-blocking**: The main agent's execution is never paused or interrupted.
- **Isolated Context**: Side questions have their own message history and do not clutter your main conversation.
- **Tool-less Assistant**: Side agents are focused on answering questions and providing explanations based on the conversation context and their internal knowledge. They do not have access to tools.
- **Multi-turn Support**: You can have a full conversation with the side agent before returning to your main task.
- **Easy Dismissal**: A simple press of the **Escape** key brings you back to your main task.

## Example Scenarios

- **Clarification**: `/btw what did we decide about the data model earlier?`
- **Explanation**: `/btw how does the MessageManager handle session IDs?`
- **Follow-up**: After asking about the data model, you can ask `/btw which file defines the SideAgentInstance?` without leaving the side view.
