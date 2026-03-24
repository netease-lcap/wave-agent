/**
 * TypeScript Interface Definitions
 * 
 * **Package**: agent-sdk
 * **Target File**: src/managers/subagentManager.ts
 * **Feature**: 015-subagent-message-callbacks
 */

// ============================================================================
// SUBAGENT MANAGER CALLBACKS (NEW DEDICATED INTERFACE)
// ============================================================================

/**
 * Dedicated SubagentManagerCallbacks interface for subagent-specific events
 * 
 * **Location**: packages/agent-sdk/src/managers/subagentManager.ts
 * **Architecture**: Separate from MessageManagerCallbacks for clean separation of concerns
 * **Compatibility**: AgentCallbacks extends this interface for end-to-end integration
 */
export interface SubagentManagerCallbacks {
  /**
   * Triggered when subagent adds user message
   * @param subagentId - Unique identifier for the subagent instance
   * @param params - User message parameters
   */
  onSubagentUserMessageAdded?: (subagentId: string, params: UserMessageParams) => void;
  
  /**
   * Triggered when subagent creates assistant message
   * @param subagentId - Unique identifier for the subagent instance
   */
  onSubagentAssistantMessageAdded?: (subagentId: string) => void;
  
  /**
   * Triggered during subagent content streaming updates
   * @param subagentId - Unique identifier for the subagent instance
   * @param chunk - New content chunk from this update
   * @param accumulated - Total accumulated content so far
   */
  onSubagentAssistantContentUpdated?: (
    subagentId: string, 
    chunk: string, 
    accumulated: string
  ) => void;
  
  /**
   * Triggered when subagent tool block is updated
   * @param subagentId - Unique identifier for the subagent instance
   * @param params - Tool update parameters
   */
  onSubagentToolBlockUpdated?: (
    subagentId: string, 
    params: AgentToolBlockUpdateParams
  ) => void;
}

// ============================================================================
// SUPPORTING TYPE DEFINITIONS
// ============================================================================

/**
 * SubagentManager options interface
 */
export interface SubagentManagerOptions {
  callbacks?: SubagentManagerCallbacks;
}

/**
 * Agent callbacks interface extends SubagentManagerCallbacks for end-to-end integration
 */
export interface AgentCallbacks extends SubagentManagerCallbacks {
  // Other agent-specific callbacks...
}

// ============================================================================
// IMPLEMENTATION GUIDANCE
// ============================================================================

/**
 * Architecture Changes:
 * 
 * 1. **SubagentManager**:
 *    - Uses `callbacks: SubagentManagerCallbacks` instead of `parentCallbacks`
 *    - Owns callback responsibility for subagent events
 *    - Forwards callbacks with subagentId context
 * 
 * 2. **Agent Integration**:
 *    - AgentCallbacks extends SubagentManagerCallbacks
 *    - Agent passes callbacks to SubagentManager
 *    - End-to-end callback flow maintained
 * 
 * 3. **Architectural Benefits**:
 *    - Clean separation between MessageManager and SubagentManager
 *    - Dedicated interfaces for each manager's responsibilities
 *    - No breaking changes to existing API surface
 */