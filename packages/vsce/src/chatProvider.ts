import * as vscode from 'vscode';
import type { SessionMetadata, ToolPermissionContext, PermissionDecision } from 'wave-agent-sdk';
import { 
    EDIT_TOOL_NAME, 
    WRITE_TOOL_NAME, 
    BASH_TOOL_NAME, 
    ENTER_PLAN_MODE_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME, 
    ASK_USER_QUESTION_TOOL_NAME 
} from 'wave-agent-sdk';
import { ChatSession } from './session/chatSession';
import { ConfigurationService, ConfigurationData } from './services/configurationService';
import { FileService } from './services/fileService';
import { SessionService } from './services/sessionService';
import { SelectionService } from './services/selectionService';
import { PluginService } from './services/pluginService';
import { WebviewManager } from './session/webviewManager';
import { MessageHandler } from './session/messageHandler';

export class ChatProvider implements vscode.WebviewViewProvider {
    private static formatConfigError(error: unknown): string {
        const field = (error as Record<string, unknown>).field;
        switch (field) {
            case 'model':
                return '请设置主模型（Model）配置';
            case 'fastModel':
                return '请设置快速模型（Fast Model）配置';
            default:
                return (error as Error).message || String(error);
        }
    }
    public static readonly viewType = 'waveChatView';
    private context: vscode.ExtensionContext;
    
    private sidebarSession: ChatSession;
    private tabSessions: Map<string, ChatSession> = new Map();
    private windowSessions: Map<string, ChatSession> = new Map();

    private configService: ConfigurationService;
    private fileService: FileService;
    private sessionService: SessionService;
    private selectionService: SelectionService;
    private pluginService: PluginService;
    private webviewManager: WebviewManager;
    private messageHandler: MessageHandler;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.configService = new ConfigurationService(context);
        this.fileService = new FileService();
        this.sessionService = new SessionService();
        this.selectionService = new SelectionService(context);
        this.pluginService = new PluginService();

        this.webviewManager = new WebviewManager(context, {
            onMessage: async (message, viewType, windowId) => {
                await this.messageHandler.handleMessage(message, viewType, windowId);
            },
            onTabDispose: (tabId) => {
                console.log(`标签页面板被关闭 - 销毁 agent 和清理资源，TabID: ${tabId}`);
                const session = this.tabSessions.get(tabId);
                if (session) {
                    session.destroy().then(() => {
                        this.tabSessions.delete(tabId);
                    });
                }
            },
            onWindowDispose: (windowId) => {
                console.log(`窗口面板被关闭 - 销毁 agent 和清理资源，窗口ID: ${windowId}`);
                const session = this.windowSessions.get(windowId);
                if (session) {
                    session.destroy().then(() => {
                        this.windowSessions.delete(windowId);
                    });
                }
            }
        });

        this.messageHandler = new MessageHandler(
            this.configService,
            this.fileService,
            this.sessionService,
            this.pluginService,
            {
                getChatSession: (viewType, windowId) => this.getChatSession(viewType, windowId),
                postMessage: (message, viewType, windowId) => this.webviewManager.postMessage(message, viewType, windowId),
                initializeAgent: (viewType, windowId, restoreSessionId) => this.initializeAgent(viewType, windowId, restoreSessionId),
                listSessions: (viewType, windowId) => this.listSessions(viewType, windowId),
                updateAllSessionsConfig: (config) => {
                    const cfg = config as ConfigurationData;
                    this.sidebarSession.updateConfig(cfg, this.context.extensionMode);
                    this.tabSessions.forEach(session => session.updateConfig(cfg, this.context.extensionMode));
                    this.windowSessions.forEach(session => session.updateConfig(cfg, this.context.extensionMode));
                }
            }
        );

        this.sidebarSession = this.createChatSession('sidebar');

        console.log('创建了 ChatProvider');
        
        // Register as webview provider for sidebar
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('waveChat', this)
        );
        
        // Listen for workspace folder changes
        const workspaceChangeListener = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            console.log('工作区文件夹已更改:', {
                added: event.added.map(f => f.uri.fsPath),
                removed: event.removed.map(f => f.uri.fsPath)
            });
        });
        
        this.context.subscriptions.push(workspaceChangeListener);

        // Listen for selection changes - removed auto-sync
        /*
        this.selectionService.onSelectionChange((selection) => {
            this.webviewManager.postMessage({
                command: 'updateSelection',
                selection
            });
        });
        */
    }

    public async addToWave() {
        const selection = this.selectionService.getSelection();
        if (!selection || selection.isEmpty) {
            vscode.window.showInformationMessage('请先在编辑器中选择一段代码');
            return;
        }

        // Ensure chat view is visible
        await this.focusView();

        // Send selection to webview
        this.webviewManager.postMessage({
            command: 'addSelectionToInput',
            selection
        });
    }

    private createChatSession(viewType: 'sidebar' | 'tab' | 'window', windowId?: string): ChatSession {
        return new ChatSession(viewType, windowId, {
            onMessagesChange: (messages) => {
                this.webviewManager.postMessage({ command: 'updateMessages', messages }, viewType, windowId);
            },
            onTasksChange: (tasks) => {
                this.webviewManager.postMessage({ command: 'updateTasks', tasks }, viewType, windowId);
            },
            onSessionIdChange: (sessionId) => {
                this.handleSessionIdChange(sessionId, viewType, windowId).catch(err =>
                    console.error(`Error handling session ID change for ${viewType}:`, err)
                );
            },
            onStreamingChange: (isStreaming) => {
                this.webviewManager.postMessage({ command: isStreaming ? 'startStreaming' : 'endStreaming' }, viewType, windowId);
            },
            onCommandRunningChange: (running) => {
                this.webviewManager.postMessage({ command: 'updateCommandRunning', running }, viewType, windowId);
            },
            onQueueChange: (queue) => {
                this.webviewManager.postMessage({ command: 'updateQueue', queue }, viewType, windowId);
            },
            onPermissionModeChange: (mode) => {
                this.webviewManager.postMessage({ command: 'updatePermissionMode', mode }, viewType, windowId);
            },
            onToolPermissionRequest: (context) => {
                return this.handleToolPermissionRequest(context, viewType, windowId);
            },
            onError: (error) => {
                const isConfigError = error && typeof error === 'object' && 'name' in error && error.name === 'ConfigurationError';
                if (isConfigError) {
                    vscode.window.showErrorMessage(ChatProvider.formatConfigError(error));
                } else {
                    vscode.window.showErrorMessage(`智能体错误: ` + error);
                }
            },
            onMcpServersChange: (servers) => {
                this.webviewManager.postMessage({ command: 'mcpServersUpdate', servers }, viewType, windowId);
            },
            // Incremental update callbacks for streaming optimization
            onAssistantMessageAdded: (message) => {
                this.webviewManager.postMessage({ command: 'appendMessage', message }, viewType, windowId);
            },
            onStreamingContentUpdate: (params) => {
                this.webviewManager.postMessage({ command: 'updateStreamingContent', ...params }, viewType, windowId);
            },
            onStreamingReasoningUpdate: (params) => {
                this.webviewManager.postMessage({ command: 'updateStreamingReasoning', ...params }, viewType, windowId);
            },
            onToolBlockUpdate: (params) => {
                this.webviewManager.postMessage({ command: 'updateToolBlock', params }, viewType, windowId);
            },
            // Bang message callbacks - send full message list update
            onBangMessageAdded: () => {
                const session = this.getChatSession(viewType, windowId);
                this.webviewManager.postMessage({ command: 'updateMessages', messages: session.messages }, viewType, windowId);
            },
            onBangMessageUpdated: () => {
                const session = this.getChatSession(viewType, windowId);
                this.webviewManager.postMessage({ command: 'updateMessages', messages: session.messages }, viewType, windowId);
            }
        });
    }

    // Implement WebviewViewProvider interface for sidebar
    public resolveWebviewView(
        webviewView: vscode.WebviewView
    ): void | Thenable<void> {
        console.log('解析侧边栏webview视图');
        this.webviewManager.setSidebarView(webviewView);

        // Set sidebar visible context
        vscode.commands.executeCommand('setContext', 'waveChatSidebarVisible', true);
    }

    private async initializeAgent(viewType: 'sidebar' | 'tab' | 'window', windowId?: string, restoreSessionId?: string) {
        const session = this.getChatSession(viewType, windowId);
        if (session.isInitializing) {
            return;
        }

        try {
            const config = await this.configService.loadConfiguration();
            
            await session.initialize(config, this.context.extensionMode, restoreSessionId);
        } catch (error) {
            console.error(`初始化 ${viewType} 智能体失败:`, error);
            const isConfigError = error && typeof error === 'object' && 'name' in error && error.name === 'ConfigurationError';
            if (isConfigError) {
                vscode.window.showErrorMessage(ChatProvider.formatConfigError(error));
            } else {
                vscode.window.showErrorMessage(`初始化 ${viewType} AI 智能体失败: ` + error);
            }
        }
    }

    private getChatSession(viewType: 'sidebar' | 'tab' | 'window', windowId?: string): ChatSession {
        if (viewType === 'sidebar') {
            return this.sidebarSession;
        } else if (viewType === 'tab' && windowId) {
            if (!this.tabSessions.has(windowId)) {
                this.tabSessions.set(windowId, this.createChatSession('tab', windowId));
            }
            return this.tabSessions.get(windowId)!;
        } else if (viewType === 'window' && windowId) {
            if (!this.windowSessions.has(windowId)) {
                this.windowSessions.set(windowId, this.createChatSession('window', windowId));
            }
            return this.windowSessions.get(windowId)!;
        } else {
            throw new Error(`Invalid view type or missing windowId: ${viewType}, ${windowId}`);
        }
    }

    /**
     * Focus the appropriate chat view and send focus message to webview
     */
    public async focusView() {
        console.log('聚焦聊天视图...');

        // Check for active views in order of priority: window > tab > sidebar
        
        // 1. Check for active window panels first
        const windowPanels = this.webviewManager.getAllWindowPanels();
        if (windowPanels.size > 0) {
            const windowPanel = windowPanels.values().next().value;
            if (windowPanel) {
                console.log('聚焦窗口视图');
                windowPanel.reveal(vscode.ViewColumn.Active);
                windowPanel.webview.postMessage({ command: 'focusInput' });
                return;
            }
        }

        // 2. Check for tab panels
        const tabPanels = this.webviewManager.getAllTabPanels();
        if (tabPanels.size > 0) {
            const tabPanel = tabPanels.values().next().value;
            if (tabPanel) {
                console.log('聚焦标签页视图');
                tabPanel.reveal(vscode.ViewColumn.Active);
                tabPanel.webview.postMessage({ command: 'focusInput' });
                return;
            }
        }

        // 3. Check for sidebar
        const sidebarView = this.webviewManager.getSidebarView();
        if (sidebarView) {
            console.log('聚焦侧边栏视图');
            await vscode.commands.executeCommand('workbench.view.extension.waveChatView');
            setTimeout(() => {
                sidebarView.webview.postMessage({ command: 'focusInput' });
            }, 100);
            return;
        }

        // 4. No views are open, create a new tab view
        console.log('未找到活动视图，创建新的标签页视图');
        await this.createOrShowChatPanel('tab');
    }



    public async createOrShowChatPanel(mode: 'sidebar' | 'tab' | 'window' = 'tab') {
        console.log(`调用了 createOrShowChatPanel，模式: ${mode}`);

        if (mode === 'sidebar') {
            if (!this.sidebarSession.agent) {
                await this.initializeAgent('sidebar');
            }
            await vscode.commands.executeCommand('workbench.view.extension.waveChatView');
            return;
        }

        if (mode === 'window') {
            const windowId = `window_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.webviewManager.createWindowPanel(ChatProvider.viewType + '_window', `Wave - 代码智聊`, windowId);
            await this.initializeAgent('window', windowId);
            await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
            return;
        }

        // Tab mode: always create a new tab
        const tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const columnToShowIn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        this.webviewManager.createTabPanel(ChatProvider.viewType, 'Wave - 代码智聊', tabId, columnToShowIn || vscode.ViewColumn.One);
        await this.initializeAgent('tab', tabId);
    }

    private async listSessions(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            const sessionsWithContent = await this.sessionService.getSessionsList();
            this.webviewManager.postMessage({
                command: 'updateSessions',
                sessions: sessionsWithContent
            }, viewType, windowId);
        } catch (error) {
            console.error(`获取 ${viewType} 会话列表失败:`, error);

            const isDirectoryNotFound = error &&
                typeof error === 'object' &&
                'code' in error &&
                error.code === 'ENOENT';

            if (isDirectoryNotFound) {
                this.webviewManager.postMessage({
                    command: 'updateSessions',
                    sessions: []
                }, viewType, windowId);
            } else {
                vscode.window.showErrorMessage('获取会话列表失败: ' + error);
            }
        }
    }

    private async handleToolPermissionRequest(context: ToolPermissionContext, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string): Promise<PermissionDecision> {
        const session = this.getChatSession(viewType || 'tab', windowId);
        
        return new Promise((resolve) => {
            const confirmationId = `confirmation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            let confirmationType: string;
            if ([EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(context.toolName)) {
                confirmationType = '代码修改待确认';
            } else if (context.toolName === BASH_TOOL_NAME) {
                confirmationType = '命令执行待确认';
            } else if (context.toolName === EXIT_PLAN_MODE_TOOL_NAME || context.toolName === ENTER_PLAN_MODE_TOOL_NAME) {
                confirmationType = '计划待确认';
            } else if (context.toolName === ASK_USER_QUESTION_TOOL_NAME) {
                confirmationType = '问题待回答';
            } else {
                confirmationType = '操作待确认';
            }

            session.pendingConfirmations.set(confirmationId, {
                resolve,
                toolName: context.toolName,
                confirmationType: confirmationType,
                toolInput: context.toolInput,
                planContent: context.planContent,
                suggestedPrefix: context.suggestedPrefix,
                hidePersistentOption: context.hidePersistentOption
            });

            this.webviewManager.postMessage({
                command: 'showConfirmation',
                confirmationId: confirmationId,
                toolName: context.toolName,
                confirmationType: confirmationType,
                toolInput: context.toolInput,
                planContent: context.planContent,
                suggestedPrefix: context.suggestedPrefix,
                hidePersistentOption: context.hidePersistentOption
            }, viewType, windowId);
        });
    }

    private async handleSessionIdChange(sessionId: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.getChatSession(viewType || 'tab', windowId);
        if (session.agent) {
            this.webviewManager.postMessage({
                command: 'updateCurrentSession',
                session: {
                    id: sessionId,
                    sessionType: 'main',
                    workdir: session.agent.workingDirectory,
                    lastActiveAt: new Date(),
                    latestTotalTokens: session.agent.latestTotalTokens
                } as SessionMetadata
            }, viewType, windowId);
            await this.listSessions(viewType, windowId);
        }
    }

    /**
     * Clean up resources when extension deactivates
     */
    public async destroy() {
        console.log('ChatProvider 正在清理资源...');
        
        try {
            await this.sidebarSession.destroy();
            for (const session of this.tabSessions.values()) {
                await session.destroy();
            }
            this.tabSessions.clear();
            for (const session of this.windowSessions.values()) {
                await session.destroy();
            }
            this.windowSessions.clear();
        } catch (error) {
            console.error('销毁智能体时出错:', error);
        }
        
        this.webviewManager.dispose();
        
        console.log('ChatProvider 资源清理完成');
    }
}
