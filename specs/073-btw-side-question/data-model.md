# Data Model: /btw Side Question

## Entities

### SideAgentInstance
- **id**: `string` (Unique identifier for the side agent instance)
- **messages**: `Message[]` (Conversation history for this specific side agent)
- **status**: `idle | running | completed | error` (Current execution state)
- **parentId**: `string` (ID of the main conversation it was spawned from)

### ChatState (Extended)
- **activeSideAgentId**: `string | null` (ID of the side agent currently being viewed)
- **sideAgentMessages**: `Record<string, Message[]>` (Map of side agent IDs to their message histories)

## State Transitions

1. **Spawn**: User inputs `/btw <question>`.
    - Create `SideAgentInstance`.
    - Set `activeSideAgentId` to the new instance ID.
    - Inherit all messages from the main conversation into `sideAgentMessages[id]`.
    - Add the new user message (`/btw <question>`) to `sideAgentMessages[id]`.
2. **Execute**: Side agent starts generating response.
    - Update `status` to `running`.
    - Append assistant content to `sideAgentMessages[id]`.
3. **Follow-up**: User inputs a message while `activeSideAgentId` is not null.
    - Add user message to `sideAgentMessages[activeSideAgentId]`.
    - Trigger side agent execution for the new message.
4. **Complete**: Side agent finishes response.
    - Update `status` to `completed`.
5. **Dismiss**: User presses `Escape`.
    - Set `activeSideAgentId` to `null`.
    - (Optional) Cleanup side agent state if no longer needed.
