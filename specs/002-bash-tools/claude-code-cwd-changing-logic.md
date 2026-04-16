# Claude Code CWD Changing Logic

## Overview

Claude Code automatically tracks and updates the working directory after every bash tool execution. This is achieved by appending a `pwd -P` command to the executed bash command and reading the result from a temporary file.

## Implementation Details

### 1. Command Construction (`src/utils/shell/bashProvider.ts`, lines 77-197)

The `buildExecCommand` function constructs the actual shell command by chaining several parts with `&&`:

```
source <snapshot> 2>/dev/null || true && eval '<user_command>' && pwd -P >| <cwdFilePath>
```

Key points:
- A temporary file path (`cwdFilePath`) is created in the system temp dir, named like `claude-<id>-cwd`
- `pwd -P` is appended to the command chain, writing the **physical** path (resolving symlinks) to the temp file
- The `>|` ensures the file is overwritten even if it already exists
- On Windows, separate `shellCwdFilePath` (POSIX path for bash) and `cwdFilePath` (native Windows path for Node.js) are used

### 2. Execution & CWD Update (`src/utils/Shell.ts`, lines 181-474)

#### Pre-execution: CWD Recovery (lines 218-238)

Before spawning the process, the code checks if the current CWD still exists on disk:

```typescript
let cwd = pwd()
try {
  await realpath(cwd)
} catch {
  const fallback = getOriginalCwd()
  // If current CWD was deleted (e.g., temp dir cleanup), recover to originalCwd
  setCwdState(fallback)
  cwd = fallback
}
```

#### Post-execution: CWD Update (lines 385-421)

After the command completes, the `.then()` callback on `shellCommand.result`:

```typescript
if (result && !preventCwdChanges && !result.backgroundTaskId) {
  try {
    let newCwd = readFileSync(nativeCwdFilePath, { encoding: 'utf8' }).trim()
    if (platform === 'windows') {
      newCwd = posixPathToWindowsPath(newCwd)
    }
    // NFC normalization for macOS APFS compatibility
    if (newCwd.normalize('NFC') !== cwd) {
      setCwd(newCwd, cwd)
      invalidateSessionEnvCache()
      void onCwdChangedForHooks(cwd, newCwd)
    }
  } catch {
    logEvent('tengu_shell_set_cwd', { success: false })
  }
}
// Clean up temp file
unlinkSync(nativeCwdFilePath)
```

Key behaviors:
- Only **foreground** tasks update CWD (`!result.backgroundTaskId`)
- Can be disabled via `preventCwdChanges` option
- Uses `readFileSync`/`unlinkSync` (synchronous) to avoid race conditions — callers who `await .result` see the updated CWD immediately
- If the new CWD path is invalid, `realpathSync` in `setCwd` throws and the old CWD is preserved

### 3. setCwd Function (`src/utils/Shell.ts`, lines 447-474)

```typescript
export function setCwd(path: string, relativeTo?: string): void {
  const resolved = isAbsolute(path) ? path : resolve(relativeTo || cwd(), path)
  // Resolve symlinks (must match pwd -P output)
  let physicalPath: string
  try {
    physicalPath = realpathSync(resolved)
  } catch (e) {
    if (isENOENT(e)) throw new Error(`Path "${resolved}" does not exist`)
    throw e
  }
  setCwdState(physicalPath)
}
```

### 4. State Storage (`src/bootstrap/state.ts`, lines 45-66)

The global `State` object holds:
- `originalCwd: string` — CWD at startup, never changes
- `cwd: string` — current tracked working directory, updated after each bash command

```typescript
setCwdState(cwd: string): void {
  STATE.cwd = cwd.normalize('NFC')
}
```

## Flow Summary

```
User calls bash tool with "cd src"
        │
        ▼
buildExecCommand appends "&& pwd -P >| /tmp/claude-xxxx-cwd"
        │
        ▼
spawn(shell, ['-c', 'eval cd src && pwd -P >| /tmp/claude-xxxx-cwd'], { cwd })
        │
        ▼
Command completes → readFileSync('/tmp/claude-xxxx-cwd') → "/path/to/src"
        │
        ▼
setCwd("/path/to/src") → realpathSync → setCwdState(physicalPath)
        │
        ▼
invalidateSessionEnvCache() + onCwdChangedForHooks()
        │
        ▼
unlinkSync('/tmp/claude-xxxx-cwd')  // cleanup
```

## Key Design Decisions

1. **No parsing of command output** — CWD tracking is done via a separate temp file, not by parsing stdout/stderr
2. **Physical paths only** — `pwd -P` and `realpathSync` ensure symlinks are resolved
3. **Synchronous cleanup** — `readFileSync`/`unlinkSync` used to avoid race conditions
4. **Error resilience** — if `pwd -P` fails or the path is invalid, the old CWD is preserved
5. **Unicode normalization** — NFC normalization on macOS to handle APFS NFD paths
6. **Background tasks excluded** — only foreground bash commands update CWD

## System Prompt Update After CWD Change

### Yes, the system prompt changes after CWD changes

The CWD is dynamically injected into the system prompt on every turn. Since `getCwd()` reads from `STATE.cwd` (the global state), and the system prompt is rebuilt at the start of each conversation turn, the new CWD automatically appears in the system prompt.

### How the CWD is injected (`src/constants/prompts.ts`)

The `getSystemPrompt()` function (line 444) calls `getCwd()` multiple times:

1. **Simple mode** (line 452):
   ```
   CWD: ${getCwd()}
   ```

2. **Environment info section** (`computeSimpleEnvInfo`, line 640-648):
   ```
   <env>
   Working directory: ${getCwd()}
   Is directory a git repo: ${isGit ? 'Yes' : 'No'}
   ...
   </env>
   ```

3. **Primary working directory** (line 674-678):
   ```typescript
   const cwd = getCwd()
   const envItems = [
     `Primary working directory: ${cwd}`,
     ...
   ]
   ```

### CWD accessor (`src/utils/cwd.ts`, lines 19-32)

```typescript
export function pwd(): string {
  return cwdOverrideStorage.getStore() ?? getCwdState()
}

export function getCwd(): string {
  try {
    return pwd()
  } catch {
    return getOriginalCwd()
  }
}
```

Key points:
- `getCwd()` reads from `STATE.cwd` via `getCwdState()` (from `src/bootstrap/state.ts`)
- Uses `AsyncLocalStorage` for per-agent CWD overrides (enables concurrent agents with different CWDs)
- Falls back to `originalCwd` if the current CWD is unavailable

### No explicit cache invalidation needed

The system prompt is **not cached** across turns — it's rebuilt on each turn by calling `getSystemPrompt()`. Since `getCwd()` reads directly from the global `STATE.cwd` (which was already updated by `setCwdState()` after the bash command), the new CWD is automatically reflected in the next turn's system prompt.

The `getSystemContext` and `getUserContext` in `src/context.ts` are memoized, but they do **not** include the CWD directly. They cache git status and CLAUDE.md content, not the working directory string.

### CwdChanged hooks (`src/utils/hooks/fileChangedWatcher.ts`, lines 133-175)

After the CWD changes, `onCwdChangedForHooks()` is called, which:

1. Executes any configured `CwdChanged` hooks via `executeCwdChangedHooks()`
2. Hooks can return:
   - `systemMessages` — injected as notifications into the conversation
   - `watchPaths` — paths to watch for file change events
3. Updates the file watcher's current CWD (`currentCwd = newCwd`)
4. Restarts file watching with paths resolved against the new CWD

```typescript
export async function onCwdChangedForHooks(oldCwd: string, newCwd: string): Promise<void> {
  if (oldCwd === newCwd) return
  
  const config = getHooksConfigFromSnapshot()
  const currentHasEnvHooks = (config?.CwdChanged?.length ?? 0) > 0 ||
                              (config?.FileChanged?.length ?? 0) > 0
  if (!currentHasEnvHooks) return
  
  currentCwd = newCwd
  await clearCwdEnvFiles()
  
  const hookResult = await executeCwdChangedHooks(oldCwd, newCwd)
  
  // Process hook results: watchPaths, systemMessages, etc.
  dynamicWatchPaths = hookResult.watchPaths
  for (const msg of hookResult.systemMessages) {
    notifyCallback?.(msg, false)
  }
  
  // Re-resolve file watcher paths against the new CWD
  if (initialized) {
    restartWatching()
  }
}
```

### Full CWD → System Prompt Flow

```
User calls bash tool with "cd src"
        │
        ▼
Command executes: eval 'cd src' && pwd -P >| /tmp/claude-xxxx-cwd
        │
        ▼
readFileSync('/tmp/claude-xxxx-cwd') → "/path/to/src"
        │
        ▼
setCwd("/path/to/src") → setCwdState(physicalPath)
  │
  ├─→ STATE.cwd = "/path/to/src"  (global state updated)
  │
  └─→ onCwdChangedForHooks(oldCwd, newCwd)
        │
        ├─→ executeCwdChangedHooks() — runs user-defined hooks
        ├─→ hook systemMessages → injected as notifications
        ├─→ update file watcher paths
        └─→ restartWatching()
        
Next conversation turn:
  │
  ▼
getSystemPrompt() called
  │
  ├─→ getCwd() → reads STATE.cwd → "/path/to/src"
  ├─→ "Working directory: /path/to/src" injected into <env> section
  └─→ System prompt sent to model with new CWD
```

### Summary: System Prompt Behavior

| Aspect | Behavior |
|--------|----------|
| CWD in system prompt | Yes, dynamically read via `getCwd()` on each turn |
| Cache invalidation | Not needed — system prompt is rebuilt per turn |
| Hook notifications | `CwdChanged` hooks can inject additional context/messages |
| File watchers | Restarted with paths relative to new CWD |
| Session env | `invalidateSessionEnvCache()` called after CWD change |

## Read / Write / Edit Tools Affected by CWD Change

### Yes, these tools are directly affected

The Read, Write, and Edit tools all use `expandPath()` (from `src/utils/path.ts:32-85`) to resolve file paths, which calls `getCwd()` as the default base directory for relative paths.

### How path resolution works (`src/utils/path.ts`)

```typescript
export function expandPath(path: string, baseDir?: string): string {
  // Default baseDir is the current tracked CWD
  const actualBaseDir = baseDir ?? getCwd() ?? getFsImplementation().cwd()
  // ...
  // Handle relative paths
  return resolve(actualBaseDir, processedPath).normalize('NFC')
}
```

Key behavior:
- If `baseDir` is **not provided**, it defaults to `getCwd()` — which reads the **current tracked CWD** from `STATE.cwd`
- If `baseDir` **is provided**, it uses that instead
- Relative paths (e.g., `src/index.ts`) are resolved relative to the base directory
- Absolute paths are returned unchanged

### Tool implementations

| Tool | File | Path Resolution |
|------|------|----------------|
| **Read** | `src/tools/FileReadTool/FileReadTool.ts` | `expandPath(file_path)` |
| **Write** | `src/tools/FileWriteTool/FileWriteTool.ts` | `expandPath(file_path)` |
| **Edit** | `src/tools/FileEditTool/FileEditTool.ts` | `expandPath(file_path)` |

All three tools call `expandPath(file_path)` without passing a `baseDir`, so they use `getCwd()` as the base.

### Practical effect

If the model runs `cd src` via the bash tool, the tracked CWD changes from `/project` to `/project/src`. Subsequent relative path operations:

| Operation | Before `cd src` | After `cd src` |
|-----------|----------------|----------------|
| `Read("index.ts")` | `/project/index.ts` | `/project/src/index.ts` |
| `Write("utils.ts")` | `/project/utils.ts` | `/project/src/utils.ts` |
| `Edit("config.json")` | `/project/config.json` | `/project/src/config.json` |

### Additional CWD usage in these tools

Beyond path resolution, the tools also use `getCwd()` for:
- **Skill directory discovery** — scanning for skill files relative to the CWD
- **Error messages** — showing the current working directory in error context
- **`toRelativePath()`** (`src/utils/path.ts:95-99`) — converting absolute paths to relative paths for token-efficient tool output, also using `getCwd()`

### Full CWD → File Tools Flow

```
User calls bash tool with "cd src"
        │
        ▼
STATE.cwd updated to "/project/src"
        │
Next turn — model calls Read("index.ts")
        │
        ▼
expandPath("index.ts") → no baseDir provided → uses getCwd()
        │
        ▼
getCwd() → STATE.cwd → "/project/src"
resolve("/project/src", "index.ts") → "/project/src/index.ts"
        │
        ▼
File read from /project/src/index.ts
```
