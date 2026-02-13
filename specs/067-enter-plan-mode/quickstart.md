# Quickstart: Enter Plan Mode

`EnterPlanMode` is a feature that allows the Wave agent to pause and design a solution before making any changes to your codebase. This ensures that you and the agent are aligned on the approach, preventing wasted effort on complex tasks.

## How it Works

When the agent encounters a non-trivial task—such as adding a new feature, refactoring multiple files, or making architectural decisions—it will proactively ask for your permission to enter **Plan Mode**.

### 1. The Request
You will see a prompt in your terminal:
`Agent wants to use EnterPlanMode. [Allow] [Deny] [Allow All]`

### 2. Planning Phase
Once you allow it, the agent enters a restricted state where it can:
- Explore your codebase (read files, search).
- Design an implementation approach.
- Write the plan to a dedicated temporary file.

During this phase, the agent **cannot** modify your source code or run destructive commands.

### 3. Reviewing the Plan
After the agent finishes its design, it will present the plan to you for review (usually via the `ExitPlanMode` tool). You can then:
- **Approve**: The agent will proceed to implement the plan.
- **Provide Feedback**: Ask the agent to refine the plan.
- **Reject**: Cancel the proposed changes.

## When to Expect It
The agent is trained to use `EnterPlanMode` for:
- **New Features**: Adding meaningful new functionality.
- **Complex Refactors**: Changes affecting multiple files or existing behavior.
- **Architectural Choices**: Choosing between different technologies or patterns.
- **Unclear Requirements**: When exploration is needed to define the scope.

## Benefits
- **No Surprises**: You see exactly what the agent intends to do before it does it.
- **Safety**: The agent is restricted to read-only actions while planning.
- **Efficiency**: Catching design flaws early saves time and prevents messy rollbacks.
