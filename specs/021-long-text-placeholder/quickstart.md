# Quickstart: Long Text Placeholder

## Overview
This feature manages user input size by replacing long pasted text with placeholders.

## Development Setup
1. Run the CLI to test input compression:
   ```bash
   pnpm -F code start
   ```

## Verification Steps

### Unit Tests
Run tests for paste handling and long text:
```bash
pnpm -F code test tests/managers/inputHandlers.test.ts
pnpm -F code test tests/managers/inputReducer.test.ts
pnpm -F code test tests/components/InputBox.test.tsx
```

### Manual Verification

#### Input Compression
1. Paste a long block of text (> 200 chars) into the input field.
2. Verify it is replaced by a `[LongText#1]` placeholder.
3. Send the message.
4. Verify the agent receives and responds to the full content of the pasted text.

#### Large Paste (Edge Case)
1. Paste a very large block of text (e.g., 10KB+) to verify all chunks are captured.
2. Verify no text is lost during the paste operation.
3. Verify a single `[LongText#1]` placeholder appears.
