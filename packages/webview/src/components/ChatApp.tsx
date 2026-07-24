import React, { useEffect, useReducer, useCallback, useRef, useState } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import type { MessageInputHandle } from './MessageInput';
import { ChatHeader } from './ChatHeader';
import { TaskList } from './TaskList';
import { QueuedMessageList } from './QueuedMessageList';
import { ConfirmationDialog } from './ConfirmationDialog';
import ConfigDialog from './ConfigDialog';
import PluginDialog from './PluginDialog';
import McpDialog from './McpDialog';
import StatusDialog from './StatusDialog';
import WelcomeView from './WelcomeView';
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
  const [queueEditWarning, setQueueEditWarning] = useState<string | null>(null);
  const messageInputRef = useRef<MessageInputHandle>(null);
  const messageListRef = useRef<{ scrollToBottom: (behavior?: ScrollBehavior) => void }>(null);
  const stateRef = useRef(state);

  // Keep stateRef in sync with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Auto-dismiss the queue-edit warning banner
  useEffect(() => {
    if (!queueEditWarning) return;
    const timer = setTimeout(() => setQueueEditWarning(null), 4000);
    return () => clearTimeout(timer);
  }, [queueEditWarning]);

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
        case 'updateWorkdir':
          dispatch({ type: 'SET_WORKDIR', payload: message.workdir });
          break;
        case 'updateQueue':
          dispatch({ type: 'SET_QUEUED_MESSAGES', payload: message.queue });
          break;
        case 'updateQueuedMessageMissing':
          // The edited queue message no longer exists. Keep input content, exit editing.
          dispatch({ type: 'SET_EDITING_QUEUED_ID', payload: null });
          setQueueEditWarning('编辑的队列消息已不存在！');
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
              queuedMessages: message.queuedMessages,
              isAuthenticated: message.isAuthenticated,
              workdir: message.workdir
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
          dispatch({ type: 'HIDE_DIALOG' });
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
        case 'triggerShortcut':
          // Forwarded IDE keymap shortcut (JetBrains): the component-scoped AnAction
          // intercepts the IDE action and forwards the intended operation here, since
          // registerCustomShortcutSet consumes the AWT event before CEF can see it.
          if (messageInputRef.current && typeof messageInputRef.current.triggerShortcut === 'function') {
            messageInputRef.current.triggerShortcut(message.name);
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
        case 'updateErrorBlock':
          dispatch({ type: 'APPEND_ERROR_BLOCK', payload: { error: message.error } });
          break;
        case 'authStatusResponse':
          dispatch({ type: 'SET_AUTHENTICATED', payload: message.isAuthenticated || false });
          break;
        case 'loginResponse':
          if (message.success) {
            dispatch({ type: 'SET_AUTHENTICATED', payload: true });
          }
          break;
        case 'logoutResponse':
          if (message.success) {
            dispatch({ type: 'SET_AUTHENTICATED', payload: false });
          }
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

  const handleLogin = useCallback(() => {
    vscode.postMessage({ command: 'login' });
  }, [vscode]);

  const handleOpenSettings = useCallback(() => {
    dispatch({ type: 'SHOW_DIALOG', payload: { type: 'config', data: stateRef.current.configurationData || {} } });
    vscode.postMessage({ command: 'getConfiguration' });
  }, [vscode]);

  const handleOpenEnterpriseConsole = useCallback(() => {
    const url = stateRef.current.configurationData?.serverUrl;
    if (url) {
      vscode.postMessage({ command: 'openExternal', url });
    }
  }, [vscode]);

  const handleLogout = useCallback(() => {
    vscode.postMessage({ command: 'logout' });
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
    if (trimmedText === '/status') {
      dispatch({ type: 'SHOW_DIALOG', payload: { type: 'status' } });
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

  const handleDeleteQueuedMessage = useCallback((id: string) => {
    // Optimistically update local state (filter by id)
    const newQueue = state.queuedMessages.filter(qm => qm.id !== id);
    dispatch({ type: 'SET_QUEUED_MESSAGES', payload: newQueue });

    // If the deleted one is being edited, exit editing mode
    if (state.editingQueuedId === id) {
      dispatch({ type: 'SET_EDITING_QUEUED_ID', payload: null });
    }

    // Notify extension to delete from SDK's queue by id
    vscode.postMessage({
      command: 'deleteQueuedMessageById',
      id
    });
  }, [state.queuedMessages, state.editingQueuedId, vscode]);

  const handleEditQueuedMessage = useCallback((id: string) => {
    const qm = state.queuedMessages.find(m => m.id === id);
    if (!qm) return;

    const text = qm.content || qm.text || '';
    const images = qm.images?.map(img => ({ data: img.path || '', mediaType: img.mimeType || '' }));

    // Load content into the input (reuse the window-message insertion mechanism)
    window.postMessage({ command: 'loadQueuedEditContent', text, images }, '*');
    dispatch({ type: 'SET_EDITING_QUEUED_ID', payload: id });
  }, [state.queuedMessages]);

  const handleSendQueuedMessage = useCallback((id: string) => {
    const qm = state.queuedMessages.find(m => m.id === id);
    if (!qm) return;

    const text = qm.content || qm.text || '';
    const images = qm.images?.map(img => ({ data: img.path || '', mediaType: img.mimeType || '' }));

    // force=true: terminate current conversation and send this message immediately
    handleSendMessage(text, images, true);

    // Optimistically remove from queue + notify backend (and exit editing if applicable)
    handleDeleteQueuedMessage(id);
  }, [state.queuedMessages, handleSendMessage, handleDeleteQueuedMessage]);

  const handleSubmitQueuedEdit = useCallback((id: string, text: string, images?: Array<{ data: string; mediaType: string; }>) => {
    vscode.postMessage({
      command: 'updateQueuedMessage',
      id,
      text,
      images
    });
    dispatch({ type: 'SET_EDITING_QUEUED_ID', payload: null });
  }, [vscode]);

  const handleCancelQueuedEdit = useCallback(() => {
    dispatch({ type: 'SET_EDITING_QUEUED_ID', payload: null });
  }, []);

  // Configuration handlers
  const handleConfigurationSave = useCallback((configData: ConfigurationData) => {
    dispatch({ type: 'SET_CONFIGURATION_LOADING', payload: true });
    vscode.postMessage({
      command: 'updateConfiguration',
      configurationData: configData
    });
  }, [vscode]);

  const handleDialogClose = useCallback(() => {
    dispatch({ type: 'HIDE_DIALOG' });
  }, []);

  // Simple streaming message detection
  const streamingMessageIndex = state.isStreaming && state.messages.length > 0 
    ? state.messages.length - 1 
    : undefined;

  // Welcome page shows only when there are no messages yet. Login is optional:
  // a direct-connect config (baseURL/apiKey) works without authentication, so an
  // unauthenticated user who sends a message must still see the chat, not the welcome page.
  const showWelcome = state.messages.length === 0;

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
      {queueEditWarning && (
        <div className="queue-edit-warning-banner" role="alert" data-testid="queue-edit-warning">
          <span className="queue-edit-warning-text">{queueEditWarning}</span>
          <button
            className="queue-edit-warning-close"
            onClick={() => setQueueEditWarning(null)}
            aria-label="关闭"
          >
            <i className="codicon codicon-close"></i>
          </button>
        </div>
      )}
      <ChatHeader
        onClearChat={handleClearChat}
        onAbortMessage={handleAbortMessage}
        isStreaming={state.isStreaming}
        messages={state.messages}
        sessions={state.sessions}
        currentSession={state.currentSession}
        onSessionSelect={handleSessionSelect}
        sessionsLoading={state.sessionsLoading}
        onOpenSettings={handleOpenSettings}
        onOpenEnterpriseConsole={handleOpenEnterpriseConsole}
        onLogout={handleLogout}
        isAuthenticated={state.isAuthenticated}
      />
      
      {showWelcome ? (
        <WelcomeView
          isAuthenticated={state.isAuthenticated}
          hasDirectConnectConfig={!!(state.configurationData?.apiKey && state.configurationData?.baseURL)}
          onLogin={handleLogin}
        />
      ) : (
        <MessageList
          ref={messageListRef}
          messages={state.messages}
          queuedMessages={state.queuedMessages}
          streamingMessageIndex={streamingMessageIndex}
          vscode={vscode}
          onRewindToMessage={handleRewindToMessage}
          workdir={state.workdir}
        />
      )}

      <div className="input-area-container">
        <div style={{ display: state.activeDialog ? 'none' : 'block' }}>
          <TaskList
            tasks={state.tasks}
            isCollapsed={state.isTaskListCollapsed}
            onToggleCollapse={() => dispatch({ type: 'TOGGLE_TASK_LIST_COLLAPSE' })}
          />
          <QueuedMessageList
            queuedMessages={state.queuedMessages}
            isCollapsed={state.isQueueCollapsed}
            onToggleCollapse={() => dispatch({ type: 'TOGGLE_QUEUE_COLLAPSE' })}
            onEdit={handleEditQueuedMessage}
            onSend={handleSendQueuedMessage}
            onDelete={handleDeleteQueuedMessage}
            editingQueuedId={state.editingQueuedId}
            vscode={vscode}
          />
        </div>

        <div style={{ display: state.pendingConfirmations.length === 0 ? 'block' : 'none' }}>
          <MessageInput
            ref={messageInputRef}
            onSendMessage={handleSendMessage}
            isStreaming={state.isStreaming}
            onAbortMessage={handleAbortMessage}
            onSubmitQueuedEdit={handleSubmitQueuedEdit}
            editingQueuedId={state.editingQueuedId}
            onCancelQueuedEdit={handleCancelQueuedEdit}
            shouldClearInput={state.shouldClearInput}
            onInputCleared={handleInputCleared}
            vscode={vscode}
            selection={state.selection}
            inputContent={state.inputContent}
            permissionMode={state.permissionMode}
            initialAttachedImages={state.attachedImages}
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
      {state.activeDialog === 'status' && (
        <StatusDialog
          onClose={handleDialogClose}
          vscode={vscode}
        />
      )}
    </div>
  );
};