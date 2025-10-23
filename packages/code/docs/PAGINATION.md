# MessageList Pagination Feature

The MessageList component now supports intelligent pagination, automatically optimizing performance and user experience for CLI applications.

## Features

### 🚀 Intelligent Pagination

- **Auto page size calculation**: Dynamically adjust number of messages per page based on terminal height (3-5 messages)
- **Auto jump to latest**: Automatically jump to latest page when new messages arrive
- **Performance optimization**: Only render current page messages, supports large amounts of messages

### ⌨️ Keyboard Navigation

- `Ctrl + U` - Previous page
- `Ctrl + D` - Next page
- `Page Up/Down` - Page navigation

### 📊 Status Display

- Page indicator: `Page 2/5`
- Message range: `Messages 6-10 / 25`
- Auto mode indicator: `(Latest)`
- Navigation hint: `Ctrl+U/D Page navigation`

## Usage

```tsx
import { MessageList } from "./components/MessageList";

function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);

  return (
    <Box flexDirection="column">
      <MessageList messages={messages} />
      {/* Other components */}
    </Box>
  );
}
```

## Pagination Logic

### Page Size Calculation

```typescript
const messagesPerPage = useMemo(() => {
  if (typeof process !== "undefined" && process.stdout && process.stdout.rows) {
    const availableLines = process.stdout.rows - MIN_LINES_FOR_UI;
    return Math.max(3, Math.min(availableLines, 5)); // Minimum 3, maximum 5
  }
  return DEFAULT_MESSAGES_PER_PAGE;
}, []);
```

- **Minimum**: 3 messages/page
- **Maximum**: 5 messages/page
- **Dynamic adjustment**: Based on `(terminal rows - 8)` calculation
- **Reserved space**: 8 lines for input box and status information

### Auto Mode vs Manual Mode

- **Auto mode**: Always displays latest messages, automatically jumps to last page when new messages arrive
- **Manual mode**: Entered after user uses keyboard navigation, stays on user-selected page
- **Intelligent switching**:
  - When user navigates to last page, automatically returns to auto mode
  - When message count changes and user is on last page, maintain auto mode

### Pagination Information Calculation

```typescript
// Auto mode pagination information
const paginationInfo = useMemo((): PaginationInfo => {
  const totalPages = Math.max(1, Math.ceil(messages.length / messagesPerPage));
  const currentPage = totalPages; // Always display last page
  const startIndex = (currentPage - 1) * messagesPerPage;
  const endIndex = Math.min(startIndex + messagesPerPage, messages.length);

  return { currentPage, totalPages, startIndex, endIndex, messagesPerPage };
}, [messages.length, messagesPerPage]);

// Display information calculation (combined with manual control)
const displayInfo = useMemo((): PaginationInfo => {
  if (manualPage === null) {
    return paginationInfo; // Auto mode
  }
  // Manual mode: Display user-selected page
  const totalPages = Math.max(1, Math.ceil(messages.length / messagesPerPage));
  const currentPage = Math.min(Math.max(1, manualPage), totalPages);
  // ...
}, [messages.length, messagesPerPage, manualPage, paginationInfo]);
```

## Performance Optimization

### Memory Optimization

- Only render current page messages: `messages.slice(displayInfo.startIndex, displayInfo.endIndex)`
- Other messages don't participate in DOM construction, significantly reducing memory usage
- Intelligent re-rendering, avoiding unnecessary component updates

### User Experience

- Message numbering maintains global consistency: `#{messageIndex + 1}`
- Smooth paging experience, no flickering
- Intuitive status feedback and navigation hints
- Friendly empty message state hints

## Keyboard Event Handling

```typescript
useInput((input, key) => {
  const totalPages = displayInfo.totalPages;
  const currentPage = manualPage ?? displayInfo.currentPage;

  if (key.ctrl) {
    switch (input) {
      case "u": // Ctrl+U - Previous page
        setManualPage(Math.max(1, currentPage - 1));
        break;
      case "d": // Ctrl+D - Next page
        setManualPage(Math.min(totalPages, currentPage + 1));
        break;
    }
  }

  // Page Up/Down support
  if (key.pageUp) {
    setManualPage(Math.max(1, currentPage - 1));
  }
  if (key.pageDown) {
    setManualPage(Math.min(totalPages, currentPage + 1));
  }
});
```

## Interface Display

### Empty Message State

```
Welcome to WAVE Code Assistant!
```

### Normal Pagination Interface

```
👤 You #6
  Can you help me with this code?

🤖 Assistant #7
  📄 Update: src/App.tsx
  ┌─────────────────────────────────────┐
  │ import React from 'react';          │
  │ // Updated code here...             │
  └─────────────────────────────────────┘

👤 You #8
  Thanks! That works perfectly.

┌─────────────────────────────────────────────────────────┐
│ Messages 6-8 / 25                     Page 2/5      Ctrl+U/D Navigation │
└─────────────────────────────────────────────────────────┘
```

### Latest Page Display

```
🤖 Assistant #25
  I've successfully updated your code!

┌─────────────────────────────────────────────────────────┐
│ Messages 23-25 / 25              Page 5/5 (Latest)   Ctrl+U/D Navigation │
└─────────────────────────────────────────────────────────┘
```

## Supported Message Types

The MessageList component supports rendering of multiple message block types:

- **Text messages** (`text`): Regular text content
- **File operations** (`file`): Create, update, delete file operations
- **Error messages** (`error`): Error message display
- **Code differences** (`diff`): Code change comparison
- **Command output** (`command_output`): Terminal command execution results
- **Tool results** (`tool`): Tool invocation results

Each type has corresponding icons and color identification, providing intuitive visual distinction.

## Technical Implementation Points

### Responsive Design

- Automatically adjust page size when terminal size changes
- Maintain user's current navigation state
- Intelligently handle edge cases

### State Management

- `manualPage`: User manually controlled page number (null indicates auto mode)
- `paginationInfo`: Auto mode pagination calculation results
- `displayInfo`: Final display pagination information

### Auto Switch Logic

```typescript
useEffect(() => {
  if (manualPage !== null) {
    // If user is currently on last page, maintain auto mode
    const totalPages = Math.ceil(messages.length / messagesPerPage);
    if (manualPage >= totalPages) {
      setManualPage(null);
    }
  }
}, [messages.length, messagesPerPage, manualPage]);
```

This pagination solution effectively solves performance issues of message lists in CLI applications, providing smooth user experience and intuitive navigation methods, especially suitable for handling large amounts of interactive messages in terminal environments.
