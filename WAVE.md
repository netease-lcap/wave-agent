# Memory

This is the AI assistant's memory file, recording important information and context.

- Use pnpm instead of npm
- Testing framework is vitest
- Don't create Markdown documents unless explicitly mentioned by user
- Don't write any types
- Use HookTester to test hooks
- `packages/*/examples` directories contain real test files that are hard to mock:
  - need to create temporary directories
  - test by sending real messages
  - cd to packages/\* and run locally with pnpm tsx
  - never access private properties directly with `(agent as any)`
- `packages/*/tests` directories contain test files that are easy to mock, can run locally and on CI/CD
- After modifying agent-sdk, need to build before using in code
- After modifications, remember to use pnpm run type-check and pnpm run lint to check
