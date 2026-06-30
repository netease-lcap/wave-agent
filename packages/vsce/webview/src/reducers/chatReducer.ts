import type { ChatState, ChatAction, MessageBlock, TextBlock, ToolBlock } from '../types';

export const initialState: ChatState = {
  messages: [],
  tasks: [],
  isTaskListVisible: false,
  isTaskListCollapsed: false,
  isQueueCollapsed: false,
  isStreaming: false,
  isCommandRunning: false,
  inputDisabled: false,
  shouldClearInput: false,
  sessions: [],
  currentSession: undefined,
  sessionsLoading: false,
  pendingConfirmations: [],
  queuedMessages: [],
  // Dialog state
  activeDialog: null,
  configurationData: undefined,
  configurationLoading: false,
  configurationError: undefined,
  configuredModels: [],
  currentModel: '',
  currentFastModel: '',
  // Permission mode state
  permissionMode: 'default',
  // Attached images state
  attachedImages: []
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_MESSAGES':
      return {
        ...state,
        messages: action.payload
      };
    case 'SET_TASKS':
      return {
        ...state,
        tasks: action.payload,
        // Show task list if there are tasks
        isTaskListVisible: action.payload.length > 0,
        // Auto-expand task list when tasks are first created
        isTaskListCollapsed: state.tasks.length === 0 && action.payload.length > 0 ? false : state.isTaskListCollapsed
      };
    case 'TOGGLE_TASK_LIST_COLLAPSE':
      return {
        ...state,
        isTaskListCollapsed: !state.isTaskListCollapsed
      };
    case 'SET_TASK_LIST_COLLAPSED':
      return {
        ...state,
        isTaskListCollapsed: action.payload
      };
    case 'TOGGLE_QUEUE_COLLAPSE':
      return {
        ...state,
        isQueueCollapsed: !state.isQueueCollapsed
      };
    case 'START_STREAMING':
      return {
        ...state,
        isStreaming: true
      };
    case 'END_STREAMING':
      return {
        ...state,
        isStreaming: false
      };
    case 'SET_INPUT_DISABLED':
      return {
        ...state,
        inputDisabled: action.payload
      };
    case 'INPUT_CLEARED':
      return {
        ...state,
        shouldClearInput: false
      };
    case 'SET_SESSIONS':
      return {
        ...state,
        sessions: action.payload,
        sessionsLoading: false
      };
    case 'SET_CURRENT_SESSION':
      return {
        ...state,
        currentSession: action.payload
      };
    case 'SET_SESSIONS_LOADING':
      return {
        ...state,
        sessionsLoading: action.payload
      };
    case 'SHOW_CONFIRMATION':
      return {
        ...state,
        pendingConfirmations: [...state.pendingConfirmations, action.payload]
      };
    case 'HIDE_CONFIRMATION':
      return {
        ...state,
        pendingConfirmations: state.pendingConfirmations.filter(c => c.confirmationId !== action.payload)
      };
    case 'SHOW_DIALOG':
      return {
        ...state,
        activeDialog: action.payload.type,
        configurationData: action.payload.data ?? state.configurationData,
        configurationLoading: false,
        configurationError: action.payload.error
      };
    case 'HIDE_DIALOG':
      return {
        ...state,
        activeDialog: null,
        configurationError: undefined
      };
    case 'SET_CONFIGURATION_LOADING':
      return {
        ...state,
        configurationLoading: action.payload
      };
    case 'SET_CONFIGURATION_ERROR':
      return {
        ...state,
        configurationError: action.payload,
        configurationLoading: false
      };
    case 'SET_CONFIGURATION_DATA':
      return {
        ...state,
        configurationData: action.payload,
        configurationLoading: false
      };
    case 'SET_CONFIGURED_MODELS':
      return {
        ...state,
        configuredModels: action.payload
      };
    case 'SET_CURRENT_MODELS':
      return {
        ...state,
        currentModel: action.payload.model,
        currentFastModel: action.payload.fastModel,
        configurationData: {
          ...state.configurationData,
          model: action.payload.model || state.configurationData?.model,
          fastModel: action.payload.fastModel || state.configurationData?.fastModel
        }
      };
    case 'SET_INITIAL_STATE':
      return {
        ...state,
        messages: action.payload.messages,
        tasks: action.payload.tasks || [],
        isTaskListVisible: (action.payload.tasks && action.payload.tasks.length > 0) ? true : false,
        isTaskListCollapsed: action.payload.isTaskListCollapsed !== undefined ? action.payload.isTaskListCollapsed : state.isTaskListCollapsed,
        isStreaming: action.payload.isStreaming !== undefined ? action.payload.isStreaming : state.isStreaming,
        isCommandRunning: action.payload.isCommandRunning !== undefined ? action.payload.isCommandRunning : state.isCommandRunning,
        sessions: action.payload.sessions || state.sessions || [],
        currentSession: action.payload.currentSession || state.currentSession,
        configurationData: action.payload.configurationData || state.configurationData,
        pendingConfirmations: action.payload.pendingConfirmations || [],
        queuedMessages: action.payload.queuedMessages || [],
        inputContent: action.payload.inputContent,
        selection: action.payload.selection,
        permissionMode: action.payload.permissionMode || state.permissionMode,
        attachedImages: action.payload.attachedImages || [],
        sessionsLoading: false,
        configurationLoading: false
      };
    case 'UPDATE_SELECTION':
      return {
        ...state,
        selection: action.payload
      };
    case 'SET_QUEUED_MESSAGES':
      return {
        ...state,
        queuedMessages: action.payload
      };
    case 'SET_COMMAND_RUNNING':
      return {
        ...state,
        isCommandRunning: action.payload
      };
    case 'SET_PERMISSION_MODE':
      return {
        ...state,
        permissionMode: action.payload
      };
    // Incremental update actions for streaming optimization
    case 'APPEND_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.payload]
      };
    case 'UPDATE_STREAMING_CONTENT': {
      const { messageId, accumulated, stage } = action.payload;
      const messageIndex = state.messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const textBlockIndex = message.blocks.findIndex(b => b.type === 'text');

      let newBlocks: MessageBlock[];
      if (textBlockIndex === -1) {
        // No text block yet, append one
        const newTextBlock: TextBlock = {
          type: 'text',
          content: accumulated,
          stage
        };
        newBlocks = [...message.blocks, newTextBlock];
      } else {
        // Update existing text block
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === textBlockIndex && block.type === 'text') {
            return { ...block, content: accumulated, stage } as TextBlock;
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      return {
        ...state,
        messages: newMessages
      };
    }
    case 'UPDATE_STREAMING_REASONING': {
      const { messageId, accumulated, stage } = action.payload;
      const messageIndex = state.messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const reasoningBlockIndex = message.blocks.findIndex(b => b.type === 'reasoning');

      let newBlocks: MessageBlock[];
      if (reasoningBlockIndex === -1) {
        // No reasoning block yet, append one
        const newReasoningBlock = {
          type: 'reasoning' as const,
          content: accumulated,
          stage
        };
        newBlocks = [...message.blocks, newReasoningBlock];
      } else {
        // Update existing reasoning block
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === reasoningBlockIndex && block.type === 'reasoning') {
            return { ...block, content: accumulated, stage };
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      return {
        ...state,
        messages: newMessages
      };
    }
    case 'UPDATE_TOOL_BLOCK': {
      const { messageId, id: toolBlockId, ...updates } = action.payload;
      const messageIndex = state.messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) return state;

      const message = state.messages[messageIndex];
      const toolBlockIndex = message.blocks.findIndex(b => b.type === 'tool' && b.id === toolBlockId);

      let newBlocks: MessageBlock[];
      if (toolBlockIndex === -1) {
        // Tool block doesn't exist yet, add it as a new block
        const newToolBlock: ToolBlock = {
          type: 'tool',
          id: toolBlockId,
          name: updates.name || '',
          stage: updates.stage || 'start',
          parameters: updates.parameters || '',
          result: updates.result || '',
          success: updates.success ?? false,
          ...updates
        };
        newBlocks = [...message.blocks, newToolBlock];
      } else {
        // Update existing tool block
        newBlocks = message.blocks.map((block, idx) => {
          if (idx === toolBlockIndex && block.type === 'tool') {
            return { ...block, ...updates };
          }
          return block;
        });
      }

      const newMessages = state.messages.map((m, idx) => {
        if (idx === messageIndex) {
          return { ...m, blocks: newBlocks };
        }
        return m;
      });

      return {
        ...state,
        messages: newMessages
      };
    }
    default:
      return state;
  }
}
