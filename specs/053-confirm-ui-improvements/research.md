# Research: Confirm Component Top Border

## Decision: Individual Border Configuration in Ink

To achieve a top-only border for the `Confirmation` component, we will use the `Box` component from Ink and configure its border properties.

### Implementation Detail

The `Box` component in Ink supports individual border control through the following props:
- `borderTop`: boolean
- `borderBottom`: boolean
- `borderLeft`: boolean
- `borderRight`: boolean

By setting `borderStyle="single"` (or another style) and then setting `borderBottom={false}`, `borderLeft={false}`, and `borderRight={false}`, we can ensure only the top border is rendered.

### Rationale

This approach is:
1. **Idiomatic**: It uses the built-in capabilities of the Ink library.
2. **Maintainable**: It's a simple configuration change on the existing `Box` component.
3. **Performant**: It doesn't require additional components or complex layout logic.

### Alternatives Considered

1. **Separate Top Border Box**: Creating a separate `Box` with `borderStyle="single"` and no content above the main content box.
   - *Rejected because*: It adds unnecessary complexity to the component tree and might complicate padding/margin management.
2. **Custom Border Characters**: Manually rendering a line of characters (e.g., `────────`) at the top.
   - *Rejected because*: It doesn't integrate with Ink's border system and might not handle resizing or different terminal widths as gracefully as the built-in border.

## Findings on Existing Usage

Similar patterns are already used in the codebase:
- `packages/code/src/components/SubagentBlock.tsx`
- `packages/code/src/components/ReasoningDisplay.tsx`

These components use `borderStyle="classic"` and disable specific borders to create a vertical line on the left. We will follow this pattern but for the top border.
