# ASCII Prototype: /btw Side Question

This prototype demonstrates the user interface transitions for the `/btw` side question feature.

## 1. Main Agent Working
The main agent is currently performing a long-running task (e.g., running tests).

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Main Agent] Running tests for packages/agent-sdk...                         │
│ [Main Agent] 🧪 tests/managers/subagentManager.test.ts (PASS)                │
│ [Main Agent] 🧪 tests/managers/slashCommandManager.test.ts (PASS)            │
│ [Main Agent] 🧪 tests/tools/bashTool.test.ts (RUNNING...)                    │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│ > /btw how do I use the Grep tool?                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 2. Side Agent View (Active)
After the user presses Enter, the UI switches to the side agent's view. The main agent continues working in the background (not visible here).

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [User] /btw how do I use the Grep tool?                                      │
│                                                                              │
│ [Side Agent] The Grep tool is a powerful search tool built on ripgrep.       │
│ You can use it to search for patterns in your codebase.                      │
│                                                                              │
│ Usage:                                                                       │
│ - pattern: The regex pattern to search for.                                  │
│ - glob: Filter files (e.g., "*.ts").                                         │
│ - output_mode: "content" (default), "files_with_matches", or "count".        │
│                                                                              │
│ Example:                                                                     │
│ Grep({ pattern: "function\\s+\\w+", glob: "src/**/*.ts" })                   │
│                                                                              │
│ Note: I don't have access to tools right now, so I can't run it for you.     │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│ [Tip] Press Escape to dismiss                                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 3. Follow-up Question in Side View
The user can ask follow-up questions within the side agent's view.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [User] /btw how do I use the Grep tool?                                      │
│ [Side Agent] The Grep tool is a powerful search tool built on ripgrep...      │
│                                                                              │
│ > can you show me a regex for finding email addresses?                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [User] /btw how do I use the Grep tool?                                      │
│ [Side Agent] The Grep tool is a powerful search tool built on ripgrep...      │
│ [User] can you show me a regex for finding email addresses?                  │
│                                                                              │
│ [Side Agent] Certainly! A common regex for finding email addresses is:       │
│ [a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}                               │
│                                                                              │
│ You can use it with the Grep tool like this:                                 │
│ Grep({ pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}" })         │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│ [Tip] Press Escape to dismiss                                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 4. Return to Main Agent
After the user presses **Escape**, the UI switches back to the main agent's view, which has progressed in the meantime.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Main Agent] Running tests for packages/agent-sdk...                         │
│ [Main Agent] 🧪 tests/managers/subagentManager.test.ts (PASS)                │
│ [Main Agent] 🧪 tests/managers/slashCommandManager.test.ts (PASS)            │
│ [Main Agent] 🧪 tests/tools/bashTool.test.ts (PASS)                          │
│ [Main Agent] 🧪 tests/tools/readTool.test.ts (PASS)                          │
│ [Main Agent] 🧪 tests/tools/editTool.test.ts (RUNNING...)                    │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│ >                                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```
