# Requirements: ACP Protocol

## Functional Requirements
- [ ] Support session lifecycle management (new, load, list, close).
- [ ] Support structured prompt handling (text, images, resource links).
- [ ] Support tool execution with permission requests.
- [ ] Support mode transitions (default, plan, acceptEdits, bypassPermissions, dontAsk).
- [ ] Correctly handle "Exit Plan Mode" tool calls with appropriate mode transitions.

## Technical Requirements
- [ ] Implement `AcpAgent` interface from `@agentclientprotocol/sdk`.
- [ ] Bridge ACP requests to `WaveAgent` methods.
- [ ] Map ACP permission outcomes to Wave permission decisions.
- [ ] Ensure streaming updates are correctly propagated to the client.
