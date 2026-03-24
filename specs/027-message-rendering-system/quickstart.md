# Quickstart: Message Rendering System

## Overview
The Message Rendering System is responsible for displaying the conversation between the user and the agent in the terminal. It handles various types of content, including text, markdown, tool calls, and shell commands, while ensuring high performance through intelligent re-rendering strategies.

## Key Components

### MessageList
The top-level component that renders the entire conversation.
- **Static Section**: Renders historical messages using Ink's `<Static>` component.
- **Dynamic Section**: Renders active blocks (e.g., running tools) for real-time updates.
- **Welcome Message**: Shows version and environment info at the start.

### MessageBlockItem
A dispatcher component that renders individual blocks based on their type:
- **Text**: Rendered as Markdown or plain text.
- **Tool**: Displays tool parameters and results.
- **Bang**: Displays shell command output.
- **Error**: Displays error messages in red.

## Performance Optimization
To keep the CLI responsive:
1. **Static Rendering**: Historical messages are "frozen" after their first render.
2. **Message Limiting**: Only the most recent 10 messages are rendered by default.
3. **Memoization**: Components use `React.memo` to avoid unnecessary re-renders.

## Example Usage

```tsx
import { MessageList } from "./components/MessageList.js";

const MyApp = ({ messages }) => (
  <MessageList 
    messages={messages} 
    version="1.0.0" 
    workdir="/home/user/project"
  />
);
```
