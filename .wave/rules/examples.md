---
paths: ["packages/*/examples/**/*"]
---
- `packages/*/examples` directories contain real test ts or tsx files that are hard to mock:
  - need to create temporary directories
  - test by sending real messages
  - run example like this: `pnpm -F xxx exec tsx examples/hi.ts`
  - never access private properties directly with `(agent as any)`
