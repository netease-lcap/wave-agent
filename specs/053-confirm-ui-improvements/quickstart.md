# Quickstart: Confirm Component Top Border

## Overview

This feature modifies the `Confirmation` component to use only a top border. This saves space in the CLI output and provides a cleaner look.

## Development Setup

1.  **Navigate to the code package**:
    ```bash
    cd packages/code
    ```

2.  **Run tests**:
    ```bash
    pnpm test tests/components/Confirmation.test.tsx
    ```

## Key Files

- `packages/code/src/components/Confirmation.tsx`: The component being modified.
- `packages/code/tests/components/Confirmation.test.tsx`: The test suite for the component.

## Verification Steps

1.  **Visual Verification**:
    Run a command that triggers a confirmation (e.g., a tool execution that requires permission) and observe the `Confirmation` component's border.
2.  **Automated Tests**:
    Ensure that the tests verify the absence of bottom, left, and right borders.
