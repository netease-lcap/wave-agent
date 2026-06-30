import React, { useEffect, useReducer, useCallback, useRef } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { ChatHeader } from './ChatHeader';
import { TaskList } from './TaskList';
import { QueuedMessageList } from './QueuedMessageList';
import { ConfirmationDialog } from './ConfirmationDialog';
import ConfigDialog from './ConfigDialog';
import PluginDialog from './PluginDialog';
import McpDialog from './McpDialog';
import ModelDialog from './ModelDialog';
import StatusDialog from './StatusDialog';
import LoginDialog from './LoginDialog';
import type {
  ChatAppProps,
  ConfigurationData,
  ConfirmationDecision,
  ToolBlockUpdateCallbackParams,
} from '../types';
import { chatReducer, initialState } from '../reducers/chatReducer';
import '../styles/ChatApp.css';

export const ChatApp: React.FC<ChatAppProps> = ({ vscode }) => {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const messageInputRef = useRef<{ focus: () => void }>(null);
  const messageListRef = useRef<{ scrollToBottom: (behavior?: ScrollBehavior) => void }>(null);
  const stateRef = useRef(state);

  // Keep stateRef in sync with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Handle messages from VS Code extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as any;

      switch (message.command) {
        case 'updateMessages':
          dispatch({ type: 'SET_MESSAGES', payload: message.messages });
          break;
        case 'updateTasks':
          dispatch({ type: 'SET_TASKS', payload: message.tasks });
          if (message.isTaskListCollapsed !== undefined) {
            dispatch({ type: 'SET_TASK_LIST_COLLAPSED', payload: message.isTaskListCollapsed });
          }
          break;
        case 'updateSelection':
          dispatch({ type: 'UPDATE_SELECTION', payload: message.selection });
          break;
        case 'updatePermissionMode':
          dispatch({ type: 'SET_PERMISSION_MODE', payload: message.mode });
          break;
        case 'updateQueue':
          dispatch({ type: 'SET_QUEUED_MESSAGES', payload: message.queue });
          break;
        case 'updateCommandRunning':
          dispatch({ type: 'SET_COMMAND_RUNNING', payload: message.running });
          break;
        // Test-only handlers 
        case 'startStreaming':
          dispatch({ type: 'START_STREAMING' });
          break;
        case 'endStreaming':
          dispatch({ type: 'END_STREAMING' });
          break;
        case 'ensureUIReset':
          dispatch({ type: 'END_STREAMING' });
          break;
        case 'updateSessions':
          dispatch({ type: 'SET_SESSIONS', payload: message.sessions });
          break;
        case 'updateCurrentSession':
          dispatch({ type: 'SET_CURRENT_SESSION', payload: message.session });
          break;
        case 'showConfirmation':
          dispatch({
            type: 'SHOW_CONFIRMATION',
            payload: {
              confirmationId: message.confirmationId,
              toolName: message.toolName,
              confirmationType: message.confirmationType,
              toolInput: message.toolInput,
              planContent: message.planContent,
              suggestedPrefix: message.suggestedPrefix,
              hidePersistentOption: message.hidePersistentOption
            }
          });
          // Scroll to bottom when confirmation is shown
          setTimeout(() => {
            if (messageListRef.current && typeof messageListRef.current.scrollToBottom === 'function') {
              messageListRef.current.scrollToBottom('smooth');
            }
          }, 0);
          break;
        case 'configurationResponse':
          dispatch({
            type: 'SET_CONFIGURATION_DATA',
            payload: message.configurationData
          });
          break;
        case 'configuredModelsResponse':
          dispatch({
            type: 'SET_CONFIGURED_MODELS',
            payload: message.models || []
          });
          // Also update current model values from agent
          if (message.currentModel !== undefined || message.currentFastModel !== undefined) {
            dispatch({
              type: 'SET_CURRENT_MODELS',
              payload: {
                model: message.currentModel || '',
                fastModel: message.currentFastModel || ''
              }
            });
          }
          break;
        case 'setInitialState':
          dispatch({
            type: 'SET_INITIAL_STATE',
            payload: {
              messages: message.messages,
              tasks: message.tasks,
              isStreaming: message.isStreaming,
              isCommandRunning: message.isCommandRunning,
              isTaskListCollapsed: message.isTaskListCollapsed,
              sessions: message.sessions,
              currentSession: message.session,
              configurationData: message.configurationData,
              pendingConfirmations: message.pendingConfirmations || (message.pendingConfirmation ? [message.pendingConfirmation] : []),
              selection: message.selection,
              inputContent: message.inputContent,
              permissionMode: message.permissionMode,
              attachedImages: message.attachedImages,
              queuedMessages: message.queuedMessages
            }
          });
          break;
        case 'showConfiguration':
          dispatch({
            type: 'SHOW_DIALOG',
            payload: {
              type: 'config' as const,
              data: message.configurationData || stateRef.current.configurationData || {},
              error: message.error
            }
          });
          break;
        case 'showDialog':
          dispatch({ type: 'SHOW_DIALOG', payload: { type: message.dialogType } });
          break;
        case 'configurationUpdated':
          // Only close config dialog; keep login dialog open for continued SSO flow
          if (stateRef.current.activeDialog !== 'login') {
            dispatch({ type: 'HIDE_DIALOG' });
          }
          break;
        case 'statusResponse':
          if (message.configurationData) {
            dispatch({ type: 'SET_CONFIGURATION_DATA', payload: message.configurationData });
          }
          break;
        case 'configurationError':
          dispatch({ type: 'SET_CONFIGURATION_ERROR', payload: message.error });
          break;
        case 'focusInput':
          // Focus the message input
          if (messageInputRef.current && typeof messageInputRef.current.focus === 'function') {
            messageInputRef.current.focus();
          }
          break;
        case 'scrollToBottom':
          // Scroll the message list to bottom
          if (messageListRef.current && typeof messageListRef.current.scrollToBottom === 'function') {
            messageListRef.current.scrollToBottom('smooth');
          }
          break;
        // Incremental update commands for streaming optimization
        case 'appendMessage':
          dispatch({ type: 'APPEND_MESSAGE', payload: message.message });
          break;
        case 'updateStreamingContent':
          dispatch({
            type: 'UPDATE_STREAMING_CONTENT',
            payload: { messageId: message.messageId, accumulated: message.accumulated, stage: message.stage }
          });
          break;
        case 'updateStreamingReasoning':
          dispatch({
            type: 'UPDATE_STREAMING_REASONING',
            payload: { messageId: message.messageId as string, accumulated: message.accumulated as string, stage: message.stage as 'end' | 'streaming' }
          });
          break;
        case 'updateToolBlock':
          dispatch({ type: 'UPDATE_TOOL_BLOCK', payload: message.params as ToolBlockUpdateCallbackParams });
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleClearChat = useCallback(() => {
    if (stateRef.current.isStreaming) return;

    vscode.postMessage({
      command: 'clearChat'
    });
  }, [vscode]);

  const handleSendMessage = useCallback((text: string, images?: Array<{ data: string; mediaType: string; }>, force: boolean = false) => {
    const trimmedText = text.trim();
    if (!trimmedText && (!images || images.length === 0)) return;

    // Intercept local slash commands — open dialogs instead of sending to agent
    if (trimmedText === '/clear') {
      handleClearChat();
      return;
    }
    if (trimmedText === '/config') {
      dispatch({ type: 'SHOW_DIALOG', payload: { type: 'config', data: stateRef.current.configurationData || {} } });
      vscode.postMessage({ command: 'getConfiguration' });
      return;
    }
    if (trimmedText === '/plugin') {
      dispatch({ type: 'SHOW_DIALOG', payload: { type: 'plugin' } });
      return;
    }
    if (trimmedText === '/mcp') {
      dispatch({ type: 'SHOW_DIALOG', payload: { type: 'mcp' } });
      return;
    }
    if (trimmedText === '/model') {
      dispatch({ type: 'SHOW_DIALOG', payload: { type: 'model', data: stateRef.current.configurationData || {} } });
      vscode.postMessage({ command: 'getConfiguration' });
      vscode.postMessage({ command: 'getConfiguredModels' });
      return;
    }
    if (trimmedText === '/status') {
      dispatch({ type: 'SHOW_DIALOG', payload: { type: 'status', data: stateRef.current.configurationData || {} } });
      return;
    }
    if (trimmedText === '/login') {
      dispatch({ type: 'SHOW_DIALOG', payload: { type: 'login', data: stateRef.current.configurationData || {} } });
      return;
    }

    // Send to extension
    vscode.postMessage({
      command: 'sendMessage',
      text: trimmedText,
      images: images,
      force: force
    });
  }, [vscode, handleClearChat]);

  const handleAbortMessage = useCallback(() => {
    if (!state.isStreaming) return;
    
    vscode.postMessage({
      command: 'abortMessage'
    });
  }, [state.isStreaming, vscode]);

  const handleDeleteQueuedMessage = useCallback((index: number) => {
    // Optimistically update local state
    const newQueue = [...state.queuedMessages];
    newQueue.splice(index, 1);
    dispatch({ type: 'SET_QUEUED_MESSAGES', payload: newQueue });

    // Notify extension to delete from SDK's queue
    vscode.postMessage({
      command: 'deleteQueuedMessage',
      index: index
    });
  }, [state.queuedMessages, vscode]);

  const handleSendQueuedMessage = useCallback((index: number) => {
    const qm = state.queuedMessages[index];
    if (!qm) return;

    // Send the queued message immediately
    const images = qm.images?.map(img => ({ data: img.path || '', mediaType: img.mimeType || '' }));
    handleSendMessage(qm.content || qm.text || '', images, true);

    // Remove from queue
    handleDeleteQueuedMessage(index);
  }, [state.queuedMessages, handleSendMessage, handleDeleteQueuedMessage]);

  // Configuration handlers
  const handleConfigurationSave = useCallback((configData: ConfigurationData) => {
    dispatch({ type: 'SET_CONFIGURATION_LOADING', payload: true });
    vscode.postMessage({
      command: 'updateConfiguration',
      configurationData: configData
    });
  }, [vscode]);

  const handleModelSave = useCallback((configData: Partial<ConfigurationData>) => {
    vscode.postMessage({
      command: 'setModel',
      configurationData: configData
    });
  }, [vscode]);

  const handleDialogClose = useCallback(() => {
    dispatch({ type: 'HIDE_DIALOG' });
  }, []);

  const handleToggleTaskList = useCallback(() => {
    dispatch({ type: 'TOGGLE_TASK_LIST_COLLAPSE' });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        e.stopPropagation();
        handleToggleTaskList();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleTaskList]);

  // Simple streaming message detection
  const streamingMessageIndex = state.isStreaming && state.messages.length > 0 
    ? state.messages.length - 1 
    : undefined;

  // Initialize webview and load sessions on component mount
  useEffect(() => {
    dispatch({ type: 'SET_SESSIONS_LOADING', payload: true });
    vscode.postMessage({
      command: 'webviewReady'
    });
  }, [vscode]);

  const handleSessionSelect = useCallback((sessionId: string) => {
    if (state.isStreaming) return;
    
    vscode.postMessage({
      command: 'restoreSession',
      sessionId
    });
  }, [state.isStreaming, vscode]);

  const handleInputCleared = useCallback(() => {
    dispatch({ type: 'INPUT_CLEARED' });
  }, []);

  // Re-focus input when command finishes running (e.g., after bang execution)
  useEffect(() => {
    if (!state.isCommandRunning && messageInputRef.current) {
      messageInputRef.current.focus();
    }
  }, [state.isCommandRunning]);

  const handleConfirmation = useCallback((confirmationId: string, decision?: ConfirmationDecision) => {
    vscode.postMessage({
      command: 'confirmationResponse',
      confirmationId,
      approved: true,
      decision
    });
    dispatch({ type: 'HIDE_CONFIRMATION', payload: confirmationId });
    
    // Scroll to bottom after confirmation is hidden and input is shown
    setTimeout(() => {
      if (messageListRef.current) {
        messageListRef.current.scrollToBottom('smooth');
      }
    }, 0);
  }, [vscode]);

  const handleRejection = useCallback((confirmationId: string) => {
    vscode.postMessage({
      command: 'confirmationResponse',
      confirmationId,
      approved: false
    });
    dispatch({ type: 'HIDE_CONFIRMATION', payload: confirmationId });

    // Scroll to bottom after confirmation is hidden and input is shown
    setTimeout(() => {
      if (messageListRef.current) {
        messageListRef.current.scrollToBottom('smooth');
      }
    }, 0);
  }, [vscode]);

  const handleRewindToMessage = useCallback((messageId: string) => {
    if (state.isStreaming) return;
    
    vscode.postMessage({
      command: 'rewindToMessage',
      messageId
    });
  }, [state.isStreaming, vscode]);

  return (
    <div className="chat-container" data-testid="chat-container">
      <ChatHeader
        onClearChat={handleClearChat}
        onAbortMessage={handleAbortMessage}
        isStreaming={state.isStreaming}
        sessions={state.sessions}
        currentSession={state.currentSession}
        onSessionSelect={handleSessionSelect}
        sessionsLoading={state.sessionsLoading}
      />
      
      <MessageList 
        ref={messageListRef}
        messages={state.messages} 
        queuedMessages={state.queuedMessages}
        streamingMessageIndex={streamingMessageIndex}
        vscode={vscode}
        onDeleteQueuedMessage={handleDeleteQueuedMessage}
        onSendQueuedMessage={handleSendQueuedMessage}
        onRewindToMessage={handleRewindToMessage}
      />

      <div className="input-area-container">
        <TaskList
          tasks={state.tasks}
          isVisible={state.isTaskListVisible}
          isCollapsed={state.isTaskListCollapsed}
          onToggleCollapse={() => dispatch({ type: 'TOGGLE_TASK_LIST_COLLAPSE' })}
        />

        <QueuedMessageList
          queuedMessages={state.queuedMessages}
          isCollapsed={state.isQueueCollapsed}
          onToggleCollapse={() => dispatch({ type: 'TOGGLE_QUEUE_COLLAPSE' })}
          onDelete={handleDeleteQueuedMessage}
          onSend={handleSendQueuedMessage}
          vscode={vscode}
        />
        
        <div style={{ display: state.pendingConfirmations.length === 0 ? 'block' : 'none' }}>
          <MessageInput
            ref={messageInputRef}
            onSendMessage={handleSendMessage}
            disabled={state.inputDisabled}
            isStreaming={state.isStreaming}
            onAbortMessage={handleAbortMessage}
            onSendQueuedMessage={state.queuedMessages.length > 0 ? () => handleSendQueuedMessage(0) : undefined}
            shouldClearInput={state.shouldClearInput}
            onInputCleared={handleInputCleared}
            vscode={vscode}
            selection={state.selection}
            inputContent={state.inputContent}
            permissionMode={state.permissionMode}
            initialAttachedImages={state.attachedImages}
            isTaskListVisible={state.isTaskListVisible && state.tasks.length > 0}
            onToggleTaskList={handleToggleTaskList}
          />
        </div>

        {state.pendingConfirmations.length > 0 && (
          <ConfirmationDialog
            key={state.pendingConfirmations[0].confirmationId}
            data-confirmation-id={state.pendingConfirmations[0].confirmationId}
            confirmation={state.pendingConfirmations[0]}
            onConfirm={handleConfirmation}
            onReject={handleRejection}
          />
        )}
      </div>

      {state.activeDialog === 'config' && (
        <ConfigDialog
          configurationData={state.configurationData || {}}
          isLoading={state.configurationLoading}
          error={state.configurationError}
          onSave={handleConfigurationSave}
          onCancel={handleDialogClose}
          vscode={vscode}
        />
      )}
      {state.activeDialog === 'plugin' && (
        <PluginDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {state.activeDialog === 'mcp' && (
        <McpDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {state.activeDialog === 'model' && (
        <ModelDialog
          configurationData={state.configurationData || {}}
          configuredModels={state.configuredModels}
          onSave={handleModelSave}
          onClose={handleDialogClose}
          vscode={vscode}
        />
      )}
      {state.activeDialog === 'status' && (
        <StatusDialog
          configurationData={state.configurationData || {}}
          onClose={handleDialogClose}
          vscode={vscode}
        />
      )}
      {state.activeDialog === 'login' && (
        <LoginDialog
          configurationData={state.configurationData || {}}
          onClose={handleDialogClose}
          vscode={vscode}
        />
      )}
    </div>
  );
};