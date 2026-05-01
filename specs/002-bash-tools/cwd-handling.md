# CWD Handling in Bash Tools

## No `cwd` parameter exposed to the model

Both Wave's and Claude Code's bash tools do NOT expose a `cwd` argument in the tool schema. The working directory is determined by the application's tracked cwd.

Wave input schema (`bashTool.ts:52-80`):
- `command` (required)
- `timeout`
- `description`
- `run_in_background`

Claude Code input schema (`BashTool.tsx:227-247`):
- `command` (required)
- `timeout`
- `description`
- `run_in_background`
- `dangerouslyDisableSandbox`
- `_simulatedSedEdit` (internal only)

## Claude Code's cwd tracking mechanism

- **Fresh shell per command**: Claude Code spawns a new shell process for each command (not a persistent shell session).
- **Cwd captured after execution**: The shell provider appends `pwd -P >| <cwdFilePath>` to every command (`bashProvider.ts:186`), writing the new cwd to a temp file.
- **Post-execution update**: After the command completes, the temp file is read and app state is updated if the cwd changed (`Shell.ts:395-409`):
  ```ts
  // Only foreground tasks update the cwd
  if (result && !preventCwdChanges && !result.backgroundTaskId) {
    let newCwd = readFileSync(nativeCwdFilePath, ...).trim()
    if (newCwd !== cwd) {
      setCwd(newCwd, cwd)
  ```
- **Main agent vs subagent**: `BashTool.tsx:643` — `preventCwdChanges = !isMainThread`. The main agent's cwd can change; subagents' cwd is frozen.
- **Safety reset**: `resetCwdIfOutsideProject` (`utils.ts:170-192`) checks if the new cwd is outside the allowed working path and resets it to the original cwd if so.

## No automatic agent notification on cwd change

- There is NO system message, reminder, or prompt update sent to the agent when the cwd changes.
- The `CwdChanged` hook (`hooks.ts:4260-4275`) fires if the user configured one, and can return `systemMessages` — but this is an optional user-configured hook, not built-in behavior.
- The agent discovers the new directory implicitly when subsequent commands produce different results.
- If the cwd gets reset by the safety net, only an analytics event is logged — no notification to the agent.

## Wave's current approach

- **Fresh shell per command**: Wave spawns a new shell process for each foreground command via `spawn(command, { shell: true, cwd: context.workdir })` (`bashTool.ts:243-250`).
- **Cwd is fixed to `context.workdir`**: Every command starts from the same working directory passed in via `context.workdir`. The shell working directory is reset to this original directory after each command completes.
- **`cd` does NOT persist between commands**: Running `cd some/dir` only affects that single command invocation. Subsequent commands still start from `context.workdir`. The agent prompt (`bashTool.ts:144-145`) explicitly instructs: "When you use `cd`, the shell working directory will be reset to the original working directory after the command completes."
- **Background tasks**: Background processes are spawned similarly and their output is written to a log file. They also start from `context.workdir`.
- **No cwd tracking**: Unlike Claude Code, Wave does NOT track cwd changes (no `pwd -P` appended, no temp file read). There is no mechanism to track or reset cwd if it leaves the allowed working directory.
