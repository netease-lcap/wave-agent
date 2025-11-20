/**
 * TypeScript Interface Definitions
 * 
 * **Package**: agent-sdk
 * **Target File**: src/managers/messageManager.ts (lines 32-73)
 * **Feature**: 015-subagent-message-callbacks
 */

// ============================================================================
// EXTENDED MESSAGE MANAGER CALLBACKS
// ============================================================================

/**
 * Extended MessageManagerCallbacks interface with subagent-specific callbacks
 * 
 * **Location**: packages/agent-sdk/src/managers/messageManager.ts
 * **Extension Strategy**: Add new optional callbacks to existing interface
 * **Compatibility**: 100% backward compatible - only additive changes
 */
export interface MessageManagerCallbacks {
  // ============================================================================
  // EXISTING CALLBACKS (unchanged - for reference only)
  // ============================================================================
  
  onMessagesChange?: (messages: Message[]) => void;
  onSessionIdChange?: (sessionId: string) => void;
  onLatestTotalTokensChange?: (latestTotalTokens: number) => void;
  onUserInputHistoryChange?: (history: string[]) => void;
  onUsagesChange?: (usages: Usage[]) => void;
  onUserMessageAdded?: (params: UserMessageParams) => void;
  onAssistantMessageAdded?: () => void;
  onAssistantContentUpdated?: (chunk: string, accumulated: string) => void;
  onToolBlockUpdated?: (params: AgentToolBlockUpdateParams) => void;
  onDiffBlockAdded?: (filePath: string, diffResult: string) => void;
  onErrorBlockAdded?: (error: string) => void;
  onCompressBlockAdded?: (insertIndex: number, content: string) => void;
  onCompressionStateChange?: (isCompressing: boolean) => void;
  onMemoryBlockAdded?: (
    content: string,
    success: boolean,
    type: "project" | "user",
    storagePath: string,
  ) => void;
  onAddCommandOutputMessage?: (command: string) => void;
  onUpdateCommandOutputMessage?: (command: string, output: string) => void;
  onCompleteCommandMessage?: (command: string, exitCode: number) => void;
  onSubAgentBlockAdded?: (
    subagentId: string,
    parameters: {
      description: string;
      prompt: string;
      subagent_type: string;
    },
  ) => void;
  onSubAgentBlockUpdated?: (
    subagentId: string,
    messages: Message[],
    status: "active" | "completed" | "error" | "aborted",
  ) => void;
  
  // ============================================================================
  // NEW SUBAGENT-SPECIFIC CALLBACKS (additive extension)
  // ============================================================================
  
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
 * Message manager options interface (unchanged)
 * Automatically supports extended callback interface
 */
export interface MessageManagerOptions {
  callbacks: MessageManagerCallbacks;
  workdir: string;
  logger?: Logger;
  sessionDir?: string;
}

// ============================================================================
// IMPLEMENTATION GUIDANCE
// ============================================================================

/**
 * Integration Points:
 * 
 * 1. **MessageManager Methods**:
 *    - addUserMessage() → onSubagentUserMessageAdded
 *    - addAssistantMessage() → onSubagentAssistantMessageAdded  
 *    - updateCurrentMessageContent() → onSubagentAssistantContentUpdated
 *    - updateToolBlock() → onSubagentToolBlockUpdated
 * 
 * 2. **SubagentManager Integration**:
 *    - createInstance() method creates callback forwarding
 *    - Forwards parent callbacks with subagentId context
 *    - Uses existing subagentCallbacks parameter pattern
 * 
 * 3. **Backward Compatibility**:
 *    - All new callbacks are optional (using ?: syntax)
 *    - Existing callbacks unchanged
 *    - No breaking changes to API surface
 */