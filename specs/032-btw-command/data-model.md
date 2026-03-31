# BTW Command Data Model

The `/btw` command introduces a new state to the `InputState` and `ChatContextType`.

## `BtwState`

```typescript
export interface BtwState {
  isActive: boolean;
  question: string;
  answer?: string;
  isLoading: boolean;
}
```

## `InputState`

The `InputState` in `inputReducer.ts` is updated to include `btwState`:

```typescript
export interface InputState {
  // ... existing fields
  btwState: BtwState;
}
```

## `ChatContextType`

The `ChatContextType` in `useChat.tsx` is updated to include `btwState` and `askBtw`:

```typescript
export interface ChatContextType {
  // ... existing fields
  btwState: BtwState;
  askBtw: (question: string) => Promise<string>;
}
```
