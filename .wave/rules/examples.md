---
paths: ["packages/*/examples/**/*"]
---
- `packages/*/examples` directories contain real test ts or tsx files that are hard to mock:
  - need to create temporary directories
  - test by sending real messages
  - run example like this: `pnpm -F xxx exec tsx examples/hi.ts`
  - use `gemini-2.5-flash` for cheaper and faster testing
  - always include a `finally` block that calls `await agent.destroy()` to ensure the process exits
  - never access private properties directly with `(agent as any)`
