# Webview Testing with Playwright

This document explains the testing approach for the Wave VS Code extension's webview functionality.

## Overview

The webview testing setup provides automated smoke tests for critical chat interface functionality using Playwright. This ensures the chat interface works correctly in isolation from the VS Code extension environment.

## Architecture

### Test Structure
```
tests/
├── fixtures/           # Test data and mock generators
│   ├── mockData.ts         # Agent data structure mocks
│   ├── streamingFixtures.ts # Streaming scenarios
│   └── agent-data-structures.md # Documentation
├── utils/              # Test utilities
│   ├── webviewTestHarness.ts   # Webview loading and mocking
│   ├── messageInjector.ts      # Message simulation utilities  
│   └── uiStateVerifier.ts      # UI state verification helpers
└── webview/           # Actual test files
    ├── basicMessageFlow.test.ts
    ├── streamingMessages.test.ts
    ├── abortFunctionality.test.ts
    ├── errorHandling.test.ts
    └── clearChat.test.ts
```

### Key Components

1. **WebviewTestHarness**: Loads chat.html directly in a browser with mocked VS Code API
2. **MessageInjector**: Simulates extension-to-webview communication
3. **UIStateVerifier**: Provides helpers for verifying UI state and interactions  
4. **MockDataGenerator**: Creates realistic test data based on actual agent SDK structures

## Test Coverage

### Major Smoke Tests

1. **Basic Message Flow** (`basicMessageFlow.test.ts`)
   - Send and display messages
   - Multiple message exchanges
   - Input functionality after messages

2. **Streaming Messages** (`streamingMessages.test.ts`)
   - Streaming message display and updates
   - Progressive content updates
   - Streaming vs completed message differentiation

3. **Abort Functionality** (`abortFunctionality.test.ts`)
   - Abort button visibility during streaming
   - Abort button interaction
   - Partial content preservation after abort

4. **Error Handling** (`errorHandling.test.ts`)
   - Error message display
   - Error recovery and continued functionality
   - Different error types

5. **Clear Chat** (`clearChat.test.ts`)
   - Clear button functionality
   - UI state reset after clearing
   - New conversation after clear

## Running Tests

```bash
# Run all webview tests
npm run test:playwright

# Run tests with UI mode for debugging
npm run test:playwright:ui

# Run full test suite
npm test
```

## Mock Data Strategy

The tests use realistic mock data based on actual wave-agent-sdk structures:

### Message Types
```typescript
// Basic text message
MockDataGenerator.createUserMessage("Hello")
MockDataGenerator.createAssistantMessage("Hi there!")

// Message with tool call
MockDataGenerator.createAssistantMessageWithTool(
    "I'll read that file for you",
    "Read", 
    '{"file_path": "/path/to/file"}',
    '{"content": "file contents"}'
)

// Error message
MockDataGenerator.createErrorMessage("File not found")
```

### Streaming Scenarios
```typescript
// Predefined streaming scenarios
StreamingFixtures.BASIC_STREAMING
StreamingFixtures.CODE_EXPLANATION
StreamingFixtures.ABORTED_STREAMING

// Custom streaming simulation
StreamingFixtures.simulateStreaming(scenario, onChunk, delay)
```

## VS Code API Mocking

The webview test harness provides a mock VS Code API that:

- Captures messages sent from webview to extension
- Provides utilities to simulate extension messages
- Maintains message history for test verification

```typescript
// Mock API usage in tests
const injector = new MessageInjector(page);

// Simulate extension message to webview
await injector.simulateExtensionMessage('updateMessages', { messages });

// Get messages sent from webview to extension  
const sentMessages = await injector.getMessagesSentToExtension();
```

## Test Data Attributes

The webview HTML uses `data-testid` attributes for reliable element selection:

```html
<div data-testid="messages-container">
<textarea data-testid="message-input">
<button data-testid="send-btn">
<button data-testid="abort-btn">
<button data-testid="clear-chat-btn">
```

This approach provides stable selectors that won't break with CSS changes.

## CI Integration

Tests are configured to run in GitHub Actions with:

- Multiple Node.js versions (18.x, 20.x)
- Chromium browser installation
- Artifact collection on test failure
- CI-optimized configuration (dot reporter, video on failure)

## Writing New Tests

### Example Test Structure

```typescript
import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';

test.describe('My New Feature', () => {
    test('should do something', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Setup test scenario
        await injector.updateMessages([...]);
        
        // Perform actions
        await ui.sendMessage('test message');
        
        // Verify results
        await ui.verifyMessageCount(2);
        const sentMessages = await injector.getMessagesSentToExtension();
        expect(sentMessages[0].command).toBe('sendMessage');
    });
});
```

### Best Practices

1. **Use the utilities**: Leverage MessageInjector and UIStateVerifier instead of raw Playwright selectors
2. **Clear state**: Use `injector.clearMessageLog()` before testing message sending
3. **Realistic data**: Use MockDataGenerator for consistent test data
4. **Wait for updates**: Use appropriate verification methods that wait for changes
5. **Test isolation**: Each test should be independent and not rely on other tests

## Limitations

- Tests run webview in isolation, not integrated with actual VS Code extension
- Mock data may not cover all edge cases of real agent behavior
- No testing of extension-specific APIs (file system access, etc.)
- Performance testing is limited to webview rendering, not agent communication

## Future Improvements

Potential enhancements for the testing setup:

1. **Integration tests**: Test actual extension-webview communication
2. **Performance tests**: Measure rendering performance with large message histories  
3. **Accessibility tests**: Verify keyboard navigation and screen reader support