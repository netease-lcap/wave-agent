# Plan: Support `wave update` command

## Context
The user wants to add support for `wave update` or `wave-code update` to update the tool to the latest version. This is a common feature for CLI tools to allow users to easily stay up to date.

## Proposed Changes

### 1. Create `packages/code/src/commands/update.ts`
This new file will contain the logic for checking the current version, fetching the latest version from the npm registry, and performing the update using the appropriate package manager.

**Key features:**
- Fetch latest version from `https://registry.npmjs.org/wave-code/latest` using the native `https` module.
- Compare current version (from `package.json`) with the latest version using `semver`.
- Detect the package manager used for installation (`npm`, `pnpm`, or `yarn`) by checking global installation lists.
- Execute the update command (e.g., `npm install -g wave-code@latest`) using `spawnSync` with `stdio: 'inherit'` to provide real-time feedback.
- Provide clear instructions if the update fails (e.g., due to permission issues).

### 2. Create `packages/code/src/utils/version.ts`
Extract version comparison logic to a utility function for better testability.

### 3. Modify `packages/code/src/index.ts`
Register the `update` command with `yargs`.

```typescript
.command("update", "Update WAVE Code to the latest version", {}, async () => {
  const { updateCommand } = await import("./commands/update.js");
  await updateCommand();
})
```

## Verification Plan

### Automated Tests
- Add unit tests for the version comparison logic in `packages/code/tests/utils/version.test.ts`.

### Manual Verification
1. Run `pnpm -F wave-code build` to build the CLI.
2. Run `node packages/code/bin/wave-code.js update`.
3. Verify that it correctly identifies the current version.
4. Verify that it correctly identifies the latest version from npm.
5. If an update is available, verify that it attempts to run the update command.
6. If no update is available, verify that it informs the user.

## Critical Files
- `packages/code/src/commands/update.ts` (New)
- `packages/code/src/utils/version.ts` (New)
- `packages/code/src/index.ts` (Modified)
- `packages/code/package.json` (Reference)
- `packages/code/tests/utils/version.test.ts` (New)
