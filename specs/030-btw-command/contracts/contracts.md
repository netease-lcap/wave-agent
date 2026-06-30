# BTW Command Contracts

The `/btw` command introduces a new contract between the `agent-sdk` and the `code` package.

## `AiService`

The `AiService` in `agent-sdk` provides the `btw` method:

```typescript
export interface AiService {
  // ... existing methods
  btw(question: string): Promise<string>;
}
```

## `Agent`

The `Agent` class in `agent-sdk` provides the `askBtw` method:

```typescript
export class Agent {
  // ... existing methods
  async askBtw(question: string): Promise<string>;
}
```

## `ChatContextType`

The `ChatContextType` in `code` package provides the `askBtw` implementation:

```typescript
export interface ChatContextType {
  // ... existing fields
  btwState: BtwState;
  askBtw: (question: string) => Promise<string>;
}
```
