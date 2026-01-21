# Quickstart: Session Management

The session management service is primarily used through the `packages/agent-sdk/src/services/session.ts` module.

## Basic Usage

### Creating a Session

```typescript
import { createSession, generateSessionId } from './services/session';

const sessionId = generateSessionId();
const workdir = process.cwd();

await createSession(sessionId, workdir, "main");
```

### Appending Messages

```typescript
import { appendMessages } from './services/session';

const messages = [
  { role: 'user', content: 'Hello!' },
  { role: 'assistant', content: 'Hi there!' }
];

await appendMessages(sessionId, messages, workdir, "main");
```

### Loading a Session

```typescript
import { loadSessionFromJsonl } from './services/session';

const sessionData = await loadSessionFromJsonl(sessionId, workdir, "main");
if (sessionData) {
  console.log(`Loaded ${sessionData.messages.length} messages`);
}
```

### Listing Sessions

```typescript
import { listSessions } from './services/session';

const sessions = await listSessions(workdir);
sessions.forEach(s => {
  console.log(`Session ${s.id} - Last active: ${s.lastActiveAt}`);
});
```

### Restoring the Latest Session

```typescript
import { handleSessionRestoration } from './services/session';

const session = await handleSessionRestoration(undefined, true, workdir);
if (session) {
  console.log(`Restored session ${session.id}`);
}
```

## Internal Components

- **PathEncoder**: Handles the mapping between working directories and filesystem-safe directory names.
- **JsonlHandler**: Provides low-level operations for reading and writing JSONL files, including the optimized `getLastMessage` method.
