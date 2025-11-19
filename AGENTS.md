# Memory

This is the AI assistant's memory file, recording important information and context.

- Use pnpm instead of npm
- Don't create Markdown documents unless explicitly mentioned by user
- `packages/*/examples` directories contain real test ts or tsx files that are hard to mock:
  - need to create temporary directories
  - test by sending real messages
  - cd to `packages/\*` and run locally with pnpm tsx
  - never access private properties directly with `(agent as any)`
- `packages/*/tests` directories contain test files that are easy to mock, can run locally and on CI/CD
  - Task vitest-expert to write tests
  - Testing framework is vitest
  - Use HookTester to test hooks
  - Use waitHelpers to wait UI change
  - Use `as unknown as` `Awaited<>` `ReturnType<>` `typeof` to simplify type check, for example: 
    - `vi.mocked(fs.readdir).mockResolvedValueOnce(initialFiles as unknown as Awaited<ReturnType<typeof fs.readdir>>);`
    - `vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true } as unknown as Awaited<ReturnType<typeof fs.stat>>);`
  - When using `mockImplementation`, function arguments don't require explicit type annotations as TypeScript can infer them from context
  - For `packages/agent-sdk/tests/agent`, mock `@/services/aiService` `@/managers/toolManager` and other services to prevent real io, refer to `packages/agent-sdk/tests/agent/agent.toolRecursion.test.ts`
- `packages/code/src/components` contains Ink components
- After modifying agent-sdk, need to build before using in code
- For type and eslint errors:
  - Don't write any types
  - If there lots of errors, task multi typescript-expert at once to fix type and eslint errors.
  - Do not modify tsconfig unless user ask you to do that
- While writing tests about `Agent`, always use `await Agent.create` instead of `new Agent`
- Do not perform git commit operation unless explicitly mentioned by user
- While implementing tasks in tasks.md:
  - MUST mark the task off as [X] by modifying the tasks.md after you complete a task
  - Task multi subagents at once to implement in parallel when possible
