# Memory

This is the AI assistant's memory file, recording important information and context.

- Use pnpm instead of npm
- Don't create Markdown documents unless explicitly mentioned by user
- Don't write any types
- `packages/*/examples` directories contain real test ts or tsx files that are hard to mock:
  - need to create temporary directories
  - test by sending real messages
  - cd to `packages/\*` and run locally with pnpm tsx
  - never access private properties directly with `(agent as any)`
- `packages/*/tests` directories contain test files that are easy to mock, can run locally and on CI/CD
  - Use vitest-expert to write tests
  - Testing framework is vitest
  - Use HookTester to test hooks
  - Use waitHelpers to wait UI change
- After modifying agent-sdk, need to build before using in code
- After modification, use typescript-expert to run `pnpm run type-check` and `pnpm run lint`, use vitest-expert to run `pnpm test`.
- Do not perform git commit operation unless explicitly mentioned by user
- Do not modify tsconfig unless user ask you to do that
- While writing tests about `Agent`, always use `await Agent.create` instead of `new Agent`
- While implementing tasks in tasks.md, always mark the task off as [X] in the tasks file after you complete a task
