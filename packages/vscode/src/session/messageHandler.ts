import * as vscode from 'vscode';
import { ChatSession } from './chatSession';
import { ConfigurationService, type ConfigurationData } from '../services/configurationService';
import { FileService } from '../services/fileService';
import { SessionService } from '../services/sessionService';
import { PluginService } from '../services/pluginService';
import type { StdioClient } from '../stdio/stdioClient';
import type { Scope, PermissionMode, PermissionDecision } from 'wave-agent-sdk/types';

export interface MessageHandlerContext {
    getChatSession: (viewType: 'sidebar' | 'tab' | 'window', windowId?: string) => ChatSession;
    postMessage: (message: unknown, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) => void;
    initializeAgent: (viewType: 'sidebar' | 'tab' | 'window', windowId?: string, restoreSessionId?: string) => Promise<void>;
    listSessions: (viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) => Promise<void>;
    updateAllSessionsConfig: (config: unknown) => void;
    getVersion: () => string;
}

export class MessageHandler {
    private configService: ConfigurationService;
    private fileService: FileService;
    private sessionService: SessionService;
    private pluginService: PluginService;
    private utilityClient: StdioClient;
    private context: MessageHandlerContext;

    constructor(
        configService: ConfigurationService,
        fileService: FileService,
        sessionService: SessionService,
        pluginService: PluginService,
        utilityClient: StdioClient,
        context: MessageHandlerContext
    ) {
        this.configService = configService;
        this.fileService = fileService;
        this.sessionService = sessionService;
        this.pluginService = pluginService;
        this.utilityClient = utilityClient;
        this.context = context;
    }

    public async handleMessage(message: unknown, viewType: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const msg = message as Record<string, unknown>;
        switch (msg.command as string) {
            case 'sendMessage':
                await this.sendMessageToAgent(msg.text as string, msg.images as Array<{ data: string; mediaType: string }>, msg.force as boolean, viewType, windowId);
                break;
            case 'clearChat':
                await this.clearChat(viewType, windowId);
                break;
            case 'compact':
                await this.compactChat(msg.customInstructions as string | undefined, viewType, windowId);
                break;
            case 'abortMessage':
                await this.abortMessage(viewType, windowId);
                break;
            case 'listSessions':
                await this.context.listSessions(viewType, windowId);
                break;
            case 'restoreSession':
                await this.restoreSession(msg.sessionId as string, viewType, windowId);
                break;
            case 'requestFileSuggestions':
                await this.handleFileSuggestionsRequest(msg.filterText as string, msg.requestId as string, viewType, windowId);
                break;
            case 'requestSlashCommands':
                await this.handleSlashCommandsRequest(msg.filterText as string, viewType, windowId);
                break;
            case 'confirmationResponse':
                await this.handleConfirmationResponse(msg.confirmationId as string, msg.approved as boolean, msg.decision, viewType, windowId);
                break;
            case 'getConfiguration':
                await this.handleGetConfiguration(viewType, windowId);
                break;
            case 'updateConfiguration':
                await this.handleUpdateConfiguration(msg.configurationData, viewType, windowId);
                await this.handleGetConfiguration(viewType, windowId);
                break;
            case 'uploadFilesToArtifacts':
                await this.handleUploadFilesToArtifacts(msg.files as Array<{ name: string; data: ArrayBuffer }>, viewType, windowId);
                break;
            case 'showError':
                vscode.window.showErrorMessage(msg.message as string);
                break;
            case 'webviewReady':
                await this.handleWebviewReady(viewType, windowId);
                break;
            case 'updateInputContent':
                this.handleUpdateInputContent(msg.content as string, viewType, windowId);
                break;
            case 'setPermissionMode':
                await this.handleSetPermissionMode(msg.mode as string, viewType, windowId);
                break;
            case 'deleteQueuedMessage':
                await this.handleDeleteQueuedMessage(msg.index as number, viewType, windowId);
                break;
            case 'updateQueuedMessage':
                await this.handleUpdateQueuedMessage(
                    msg.id as string,
                    msg.text as string,
                    msg.images as Array<{ path: string; mimeType: string }> | undefined,
                    viewType,
                    windowId,
                );
                break;
            case 'deleteQueuedMessageById':
                await this.handleDeleteQueuedMessageById(msg.id as string, viewType, windowId);
                break;
            case 'listPlugins':
                await this.handleListPlugins(viewType, windowId);
                break;
            case 'installPlugin':
                await this.handleInstallPlugin(msg.pluginId as string, msg.scope as string, viewType, windowId);
                break;
            case 'enablePlugin':
                await this.handleEnablePlugin(msg.pluginId as string, msg.scope as string, viewType, windowId);
                break;
            case 'disablePlugin':
                await this.handleDisablePlugin(msg.pluginId as string, msg.scope as string, viewType, windowId);
                break;
            case 'getProjectSettings':
                await this.handleGetProjectSettings(viewType, windowId);
                break;
            case 'setBuiltinPluginEnabled':
                await this.handleSetBuiltinPluginEnabled(msg.pluginId as string, msg.enabled as boolean, msg.scope as string, viewType, windowId);
                break;
            case 'uninstallPlugin':
                await this.handleUninstallPlugin(msg.pluginId as string, viewType, windowId);
                break;
            case 'updatePlugin':
                await this.handleUpdatePlugin(msg.pluginId as string, viewType, windowId);
                break;
            case 'listMarketplaces':
                await this.handleListMarketplaces(viewType, windowId);
                break;
            case 'addMarketplace':
                await this.handleAddMarketplace(msg.input as string, viewType, windowId);
                break;
            case 'removeMarketplace':
                await this.handleRemoveMarketplace(msg.name as string, viewType, windowId);
                break;
            case 'updateMarketplace':
                await this.handleUpdateMarketplace(msg.name as string, viewType, windowId);
                break;
            case 'openFile':
                await this.handleOpenFile(msg.path as string, msg.startLine as number, msg.endLine as number);
                break;
            case 'previewImage':
                await this.handlePreviewImage(msg.path as string);
                break;
            case 'openExternal':
                await this.handleOpenExternal(msg.url as string);
                break;
            case 'rewindToMessage':
                await this.handleRewindToMessage(msg.messageId as string, viewType, windowId);
                break;
            case 'listRewindCheckpoints':
                await this.handleListRewindCheckpoints(viewType, windowId);
                break;
            case 'getConfiguredModels':
                await this.handleGetConfiguredModels(viewType, windowId);
                break;
            case 'setModel':
                await this.handleSetModel(msg.model as string, viewType, windowId);
                break;
            case 'askBtw':
                await this.handleAskBtw(msg.question as string, viewType, windowId);
                break;
            case 'requestHistory':
                await this.handleRequestHistory(viewType, windowId);
                break;
            case 'searchHistory':
                await this.handleSearchHistory(msg.query as string, viewType, windowId);
                break;
            case 'getAuthStatus':
                await this.handleGetAuthStatus(viewType, windowId);
                break;
            case 'login':
                await this.handleLogin(viewType, windowId);
                break;
            case 'logout':
                await this.handleLogout(viewType, windowId);
                break;
            case 'getStatus':
                await this.handleGetStatus(viewType, windowId);
                break;
            case 'getMcpServers':
                await this.handleGetMcpServers(viewType, windowId);
                break;
            case 'getSubagentConfigurations':
                await this.handleGetSubagentConfigurations(viewType, windowId);
                break;
            case 'connectMcpServer':
                await this.handleConnectMcpServer(msg.serverName as string, viewType, windowId);
                break;
            case 'disconnectMcpServer':
                await this.handleDisconnectMcpServer(msg.serverName as string, viewType, windowId);
                break;
            case 'getBackgroundTaskOutput': {
                const session = this.context.getChatSession(viewType || 'tab', windowId);
                const taskId = msg.taskId as string;
                const output = await session.getBackgroundTaskOutput(taskId);
                this.context.postMessage({ command: 'backgroundTaskOutput', taskId, output }, viewType, windowId);
                break;
            }
            case 'stopBackgroundTask': {
                const session = this.context.getChatSession(viewType || 'tab', windowId);
                const taskId = msg.taskId as string;
                const success = await session.stopBackgroundTask(taskId);
                this.context.postMessage({ command: 'backgroundTaskStopped', taskId, success }, viewType, windowId);
                break;
            }
            case 'backgroundCurrentTask': {
                const session = this.context.getChatSession(viewType || 'tab', windowId);
                await session.backgroundCurrentTask();
                break;
            }
            case 'getWorkflowRuns': {
                const session = this.context.getChatSession(viewType || 'tab', windowId);
                const runs = await session.getWorkflowRuns();
                this.context.postMessage({ command: 'workflowRunsResponse', runs }, viewType, windowId);
                break;
            }
            case 'stopWorkflowRun': {
                const session = this.context.getChatSession(viewType || 'tab', windowId);
                const runId = msg.runId as string;
                const success = await session.stopWorkflowRun(runId);
                this.context.postMessage({ command: 'workflowRunStopped', runId, success }, viewType, windowId);
                break;
            }
        }
    }

    private async handleRequestHistory(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            const result = await this.utilityClient.request('getPromptHistory') as { history: unknown[] };
            this.context.postMessage({
                command: 'historyResponse',
                history: result.history
            }, viewType, windowId);
        } catch (error) {
            console.error(`获取 ${viewType} 历史记录失败:`, error);
            this.context.postMessage({
                command: 'historyError',
                error: '获取历史记录失败: ' + error
            }, viewType, windowId);
        }
    }

    private async handleSearchHistory(query: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            const result = await this.utilityClient.request('searchPromptHistory', { query }) as { history: unknown[] };
            this.context.postMessage({
                command: 'historyResponse',
                history: result.history
            }, viewType, windowId);
        } catch (error) {
            console.error(`搜索 ${viewType} 历史记录失败:`, error);
            this.context.postMessage({
                command: 'historyError',
                error: '搜索历史记录失败: ' + error
            }, viewType, windowId);
        }
    }

    private async handleRewindToMessage(messageId: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        // The webview already showed the confirmation dialog — execute directly.
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            await session.rewindToMessage(messageId);
            // Notify frontend to update state (including inputContent)
            await this.handleWebviewReady(viewType, windowId);
            this.context.postMessage({ command: 'focusInput' }, viewType, windowId);
            this.context.postMessage({ command: 'scrollToBottom' }, viewType, windowId);
        } catch (error) {
            console.error(`回滚 ${viewType} 会话失败:`, error);
            vscode.window.showErrorMessage('回滚失败: ' + error);
        }
    }

    private async handleListRewindCheckpoints(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            const { checkpoints } = await session.agent?.listRewindCheckpoints() ?? { checkpoints: [] };
            this.context.postMessage({
                command: 'rewindCheckpoints',
                checkpoints
            }, viewType, windowId);
        } catch (error) {
            console.error(`获取 ${viewType} 回退检查点失败:`, error);
            this.context.postMessage({
                command: 'rewindCheckpoints',
                checkpoints: []
            }, viewType, windowId);
        }
    }

    private async handleGetConfiguredModels(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            const result = await session.agent?.getConfiguredModels() ?? { models: [], currentModel: undefined };
            this.context.postMessage({
                command: 'configuredModels',
                models: result.models,
                currentModel: result.currentModel
            }, viewType, windowId);
        } catch (error) {
            console.error(`获取 ${viewType} 模型列表失败:`, error);
            this.context.postMessage({
                command: 'configuredModels',
                models: [],
                currentModel: undefined
            }, viewType, windowId);
        }
    }

    private async handleSetModel(model: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            await session.agent?.setModel(model);
        } catch (error) {
            console.error(`设置 ${viewType} 模型失败:`, error);
        }
    }

    private async handleAskBtw(question: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            const answer = await session.askBtw(question);
            this.context.postMessage({
                command: 'btwResponse',
                question,
                answer
            }, viewType, windowId);
        } catch (error) {
            console.error(`旁路提问 ${viewType} 失败:`, error);
            this.context.postMessage({
                command: 'btwError',
                question,
                error: error instanceof Error ? error.message : String(error)
            }, viewType, windowId);
        }
    }

    private async handleOpenFile(filePath: string, startLine?: number, endLine?: number) {
        if (!filePath) return;

        const uri = vscode.Uri.file(filePath);
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);

            if (startLine !== undefined) {
                const start = new vscode.Position(Math.max(0, startLine - 1), 0);
                const end = new vscode.Position(Math.max(0, (endLine || startLine) - 1), 0);
                editor.selection = new vscode.Selection(start, end);
                editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
            }
        } catch {
            // Binary files (images, PDFs, etc.) cannot be opened as text —
            // fall back to VS Code's built-in viewer.
            try {
                await vscode.commands.executeCommand('vscode.open', uri);
            } catch (fallbackError) {
                console.error('打开文件失败:', fallbackError);
                vscode.window.showErrorMessage('打开文件失败: ' + fallbackError);
            }
        }
    }

    private async handleOpenExternal(url: string) {
        if (!url) return;

        try {
            await vscode.env.openExternal(vscode.Uri.parse(url));
        } catch (error) {
            console.error('打开外部链接失败:', error);
            vscode.window.showErrorMessage('打开外部链接失败: ' + error);
        }
    }

    private async handlePreviewImage(filePath: string) {
        if (!filePath) return;
        
        try {
            const uri = vscode.Uri.file(filePath);
            await vscode.commands.executeCommand('vscode.open', uri);
        } catch (error) {
            console.error('预览图片失败:', error);
            vscode.window.showErrorMessage('预览图片失败: ' + error);
        }
    }

    private async handleListPlugins(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            const plugins = await this.pluginService.listPlugins();
            this.context.postMessage({ command: 'listPluginsResponse', plugins }, viewType, windowId);
        } catch (error) {
            vscode.window.showErrorMessage('获取插件列表失败: ' + error);
        }
    }

    private async handleInstallPlugin(pluginId: string, scope: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            await this.pluginService.installPlugin(pluginId, scope as Scope);
            vscode.window.showInformationMessage(`插件 ${pluginId} 安装成功`);
            await this.handleListPlugins(viewType, windowId);
            
            // Reload config and recreate agents to apply plugin changes
            const config = await this.configService.loadConfiguration();
            this.context.updateAllSessionsConfig(config);
        } catch (error) {
            vscode.window.showErrorMessage('安装插件失败: ' + error);
        }
    }

    private async handleEnablePlugin(pluginId: string, scope: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            await this.pluginService.enablePlugin(pluginId, scope as Scope);
            await this.handleListPlugins(viewType, windowId);
            
            // Reload config and recreate agents to apply plugin changes
            const config = await this.configService.loadConfiguration();
            this.context.updateAllSessionsConfig(config);
        } catch (error) {
            vscode.window.showErrorMessage('启用插件失败: ' + error);
        }
    }

    private async handleDisablePlugin(pluginId: string, scope: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            await this.pluginService.disablePlugin(pluginId, scope as Scope);
            await this.handleListPlugins(viewType, windowId);

            // Reload config and recreate agents to apply plugin changes
            const config = await this.configService.loadConfiguration();
            this.context.updateAllSessionsConfig(config);
        } catch (error) {
            vscode.window.showErrorMessage('禁用插件失败: ' + error);
        }
    }

    private async handleGetProjectSettings(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            const result = await this.pluginService.getProjectSettings();
            this.context.postMessage({ command: 'projectSettings', enabledPlugins: result.enabledPlugins }, viewType, windowId);
        } catch (error) {
            vscode.window.showErrorMessage('获取项目设置失败: ' + error);
        }
    }

    private async handleSetBuiltinPluginEnabled(pluginId: string, enabled: boolean, scope: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            const result = await this.pluginService.setBuiltinPluginEnabled(pluginId, enabled, scope as Scope);
            this.context.postMessage({ command: 'projectSettings', enabledPlugins: result.enabledPlugins }, viewType, windowId);

            // Reload config and recreate agents to apply plugin changes
            const config = await this.configService.loadConfiguration();
            this.context.updateAllSessionsConfig(config);
        } catch (error) {
            vscode.window.showErrorMessage('修改项目设置失败: ' + error);
        }
    }

    private async handleUninstallPlugin(pluginId: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            await this.pluginService.uninstallPlugin(pluginId);
            vscode.window.showInformationMessage('插件卸载成功');
            await this.handleListPlugins(viewType, windowId);
            
            // Reload config and recreate agents to apply plugin changes
            const config = await this.configService.loadConfiguration();
            this.context.updateAllSessionsConfig(config);
        } catch (error) {
            vscode.window.showErrorMessage('卸载插件失败: ' + error);
        }
    }

    private async handleUpdatePlugin(pluginId: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            await this.pluginService.updatePlugin(pluginId);
            vscode.window.showInformationMessage(`插件 ${pluginId} 更新成功`);
            await this.handleListPlugins(viewType, windowId);
            
            // Reload config and recreate agents to apply plugin changes
            const config = await this.configService.loadConfiguration();
            this.context.updateAllSessionsConfig(config);
        } catch (error) {
            vscode.window.showErrorMessage('更新插件失败: ' + error);
        }
    }

    private async handleListMarketplaces(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            const marketplaces = await this.pluginService.listMarketplaces();
            this.context.postMessage({ command: 'listMarketplacesResponse', marketplaces }, viewType, windowId);
        } catch (error) {
            vscode.window.showErrorMessage('获取市场列表失败: ' + error);
        }
    }

    private async handleAddMarketplace(input: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            await this.pluginService.addMarketplace(input);
            vscode.window.showInformationMessage('市场添加成功');
            await this.handleListMarketplaces(viewType, windowId);
        } catch (error) {
            vscode.window.showErrorMessage('添加市场失败: ' + error);
        }
    }

    private async handleRemoveMarketplace(name: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            await this.pluginService.removeMarketplace(name);
            await this.handleListMarketplaces(viewType, windowId);
        } catch (error) {
            vscode.window.showErrorMessage('移除市场失败: ' + error);
        }
    }

    private async handleUpdateMarketplace(name?: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            await this.pluginService.updateMarketplace(name);
            vscode.window.showInformationMessage('市场更新成功');
            await this.handleListMarketplaces(viewType, windowId);
        } catch (error) {
            vscode.window.showErrorMessage('更新市场失败: ' + error);
        }
    }

    private async handleSetPermissionMode(mode: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            await session.setPermissionMode(mode as PermissionMode);
        } catch (error) {
            console.error(`设置 ${viewType} 权限模式失败:`, error);
            vscode.window.showErrorMessage('设置权限模式失败: ' + error);
        }
    }

    private async handleDeleteQueuedMessage(index: number, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        session.deleteQueuedMessage(index);
    }

    private async handleUpdateQueuedMessage(
        id: string,
        text: string,
        images: Array<{ path: string; mimeType: string }> | undefined,
        viewType?: 'sidebar' | 'tab' | 'window',
        windowId?: string,
    ) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        const ok = await session.updateQueuedMessage(id, text, images);
        if (!ok) {
            this.context.postMessage({
                command: 'updateQueuedMessageMissing',
                id,
            }, viewType, windowId);
        }
    }

    private async handleDeleteQueuedMessageById(id: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        await session.deleteQueuedMessageById(id);
    }

    private handleUpdateInputContent(content: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        session.inputContent = content;
    }

    private async sendMessageToAgent(text: string, images?: Array<{ data: string; mediaType: string; }>, force?: boolean, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            await session.sendMessage(text, images, force);
        } catch (error) {
            console.error(`发送消息给 ${viewType} 智能体时出错:`, error);
            vscode.window.showErrorMessage('发送消息失败: ' + error);
        }
    }

    private async abortMessage(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        session.abortMessage();
    }

    private async clearChat(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            await session.clearChat();
            // No full-snapshot push from the server — deliver the (now empty)
            // list so the webview actually clears.
            this.context.postMessage({ command: 'updateMessages', messages: session.messages }, viewType, windowId);
        } catch (error) {
            console.error(`清除 ${viewType} 聊天会话失败:`, error);
            vscode.window.showErrorMessage('清除聊天失败: ' + error);
        }
    }

    private async compactChat(customInstructions: string | undefined, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            await session.compact(customInstructions);
        } catch (error) {
            console.error(`压缩 ${viewType} 聊天会话失败:`, error);
            vscode.window.showErrorMessage('压缩对话失败: ' + error);
        }
    }

    private async restoreSession(sessionId: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        if (!sessionId) return;
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            await session.restoreSession(sessionId);
            // No full-snapshot push from the server — deliver the restored list
            // so the webview re-renders instead of keeping the welcome page.
            this.context.postMessage({ command: 'updateMessages', messages: session.messages }, viewType, windowId);
        } catch (error) {
            console.error(`恢复 ${viewType} 会话失败:`, error);
            vscode.window.showErrorMessage('恢复会话失败: ' + error);
        }
    }

    private async handleFileSuggestionsRequest(filterText: string, requestId: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            const files = await this.fileService.findWorkspaceFiles(filterText);
            this.context.postMessage({
                command: 'fileSuggestionsResponse',
                suggestions: files,
                filterText: filterText,
                requestId: requestId
            }, viewType, windowId);
        } catch (error) {
            console.error(`获取 ${viewType} 文件建议失败:`, error);
            this.context.postMessage({
                command: 'fileSuggestionsError',
                error: '获取文件建议失败: ' + error,
                requestId: requestId
            }, viewType, windowId);
        }
    }

    private async handleUploadFilesToArtifacts(files: Array<{ name: string; data: ArrayBuffer }>, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            const { uploadedFiles, errors } = await this.fileService.uploadFilesToArtifacts(files);
            if (uploadedFiles.length > 0) {
                this.context.postMessage({
                    command: 'uploadSuccess',
                    uploadedFiles: uploadedFiles,
                    message: `成功上传 ${uploadedFiles.length} 个文件到临时目录`
                }, viewType, windowId);
                vscode.window.showInformationMessage(`成功上传 ${uploadedFiles.length} 个文件到临时目录`);
            }
            if (errors.length > 0) {
                this.context.postMessage({
                    command: 'uploadError',
                    errors: errors,
                    message: `部分文件上传失败: ${errors.length} 个错误`
                }, viewType, windowId);
                vscode.window.showErrorMessage(`部分文件上传失败: ${errors.length} 个错误`);
            }
        } catch (error) {
            console.error(`文件上传处理失败:`, error);
            this.context.postMessage({
                command: 'uploadError',
                error: '文件上传处理失败: ' + error,
            }, viewType, windowId);
        }
    }

    private async handleConfirmationResponse(confirmationId: string, approved: boolean, decision: unknown, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        const pending = session.pendingConfirmations.get(confirmationId);
        if (!pending) {
            console.warn(`收到 ${viewType} 未知确认响应:`, confirmationId);
            return;
        }
        session.pendingConfirmations.delete(confirmationId);
        if (approved) {
            if (decision) {
                pending.resolve(decision as PermissionDecision);
            } else {
                pending.resolve({ behavior: 'allow' } as PermissionDecision);
            }
        } else {
            pending.resolve({ behavior: 'deny', message: '用户拒绝了操作' });
            session.abortMessage();
        }
        this.context.postMessage({ command: 'focusInput' }, viewType, windowId);
        this.context.postMessage({ command: 'scrollToBottom' }, viewType, windowId);
    }

    private async handleGetConfiguration(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string): Promise<void> {
        try {
            const config = await this.configService.loadConfiguration();
            this.context.postMessage({
                command: 'configurationResponse',
                configurationData: config
            }, viewType, windowId);
        } catch (error) {
            console.error(`Failed to get ${viewType} configuration:`, error);
            this.context.postMessage({
                command: 'configurationError',
                error: 'Failed to load configuration: ' + error
            }, viewType, windowId);
        }
    }

    private async handleUpdateConfiguration(configData: unknown, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string): Promise<void> {
        try {
            await this.configService.saveConfiguration(configData as Partial<ConfigurationData>);
            const config = await this.configService.loadConfiguration();
            
            this.context.updateAllSessionsConfig(config);

            this.context.postMessage({ command: 'configurationUpdated' }, viewType, windowId);
            this.context.postMessage({ command: 'focusInput' }, viewType, windowId);
            this.context.postMessage({ command: 'scrollToBottom' }, viewType, windowId);
        } catch (error) {
            console.error(`Failed to update ${viewType} configuration:`, error);
            this.context.postMessage({
                command: 'configurationError',
                error: 'Failed to save configuration: ' + error
            }, viewType, windowId);
        }
    }

    private async handleWebviewReady(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string): Promise<void> {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        if (!session.agent) {
            await this.context.initializeAgent(viewType || 'tab', windowId);
        }
        // No full-snapshot push anymore — the webview pulls the message list on
        // demand (webviewReady / restore / rewind / clear / compact).
        await session.getMessages();
        const configurationData = await this.configService.loadConfiguration();
        const sessions = await this.sessionService.getSessionsList();
        let isAuthenticated = false;
        try {
            const authResult = await this.utilityClient.request('getAuthStatus') as { isAuthenticated: boolean; serverUrl: string };
            isAuthenticated = authResult.isAuthenticated;
            await this.configService.saveConfiguration({ serverUrl: authResult.serverUrl });
            // Reflect the freshly fetched serverUrl in the state sent to the webview;
            // configurationData was loaded before saveConfiguration, so it would otherwise
            // carry a stale/empty serverUrl (breaking the "enterprise console" action).
            configurationData.serverUrl = authResult.serverUrl;
        } catch (error) {
            console.error('Failed to get auth status on webview ready:', error);
        }
        const pendingConfirmations = Array.from(session.pendingConfirmations.entries()).map(([confirmationId, pending]) => ({
            confirmationId,
            toolName: pending.toolName,
            confirmationType: pending.confirmationType,
            toolInput: pending.toolInput,
            suggestedPrefix: pending.suggestedPrefix,
            permissionMode: pending.permissionMode
        }));

        this.context.postMessage({
            command: 'setInitialState',
            messages: session.messages,
            tasks: session.tasks,
            backgroundTasks: session.backgroundTasks,
            workflowRuns: session.workflowRuns,
            inputContent: session.inputContent,
            isStreaming: session.isStreaming,
            isCommandRunning: session.isCommandRunning,
            sessions: sessions,
            session: session.sessionId && session.agent ? {
                id: session.sessionId,
                sessionType: 'main',
                workdir: session.agent.workingDirectory,
                lastActiveAt: new Date(),
                latestTotalTokens: session.agent.latestTotalTokens
            } : undefined,
            configurationData,
            pendingConfirmations,
            permissionMode: session.agent?.getPermissionMode(),
            queuedMessages: session.messageQueue,
            isAuthenticated,
            workdir: session.agent?.workingDirectory
        }, viewType, windowId);
    }

    private async handleSlashCommandsRequest(filterText: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            const sdkCommands = await session.getSlashCommands();

            // Local UI slash commands (not in SDK, intercepted in webview)
            const localCommands = [
                { id: 'config', name: 'config', description: '打开配置设置' },
                { id: 'plugin', name: 'plugin', description: '打开插件管理' },
                { id: 'mcp', name: 'mcp', description: '打开 MCP 服务器管理' },
                { id: 'status', name: 'status', description: '查看当前状态' },
                { id: 'clear', name: 'clear', description: '清除对话历史并重置会话' },
                { id: 'compact', name: 'compact', description: '手动压缩对话历史' },
                { id: 'tasks', name: 'tasks', description: '查看后台任务' },
                { id: 'workflows', name: 'workflows', description: '查看工作流运行' },
                { id: 'agents', name: 'agents', description: '查看可用 agents' },
                { id: 'rewind', name: 'rewind', description: '回退到之前的用户消息' },
                { id: 'model', name: 'model', description: '切换 AI 模型' },
                { id: 'btw', name: 'btw', description: '旁路提问（不进入聊天记录）' }
            ];

            const allCommands = [...sdkCommands, ...localCommands];

            let filteredCommands = allCommands;
            if (filterText && filterText.trim().length > 0) {
                const filter = filterText.toLowerCase();
                filteredCommands = allCommands.filter(command =>
                    command.id.toLowerCase().includes(filter) ||
                    command.name.toLowerCase().includes(filter)
                );
            }
            const commands = filteredCommands.map(command => ({
                id: command.id,
                name: command.name,
                description: command.description
            }));
            this.context.postMessage({
                command: 'slashCommandsResponse',
                commands: commands
            }, viewType, windowId);
        } catch (error) {
            console.error(`获取 ${viewType} 指令失败:`, error);
            this.context.postMessage({
                command: 'slashCommandsError',
                error: '获取指令失败: ' + error
            }, viewType, windowId);
        }
    }

    private async handleGetAuthStatus(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            const result = await this.utilityClient.request('getAuthStatus') as {
                isAuthenticated: boolean;
                user: { id: string; email?: string } | undefined;
                serverUrl: string;
            };
            await this.configService.saveConfiguration({ serverUrl: result.serverUrl });
            this.context.postMessage({
                command: 'authStatusResponse',
                isAuthenticated: result.isAuthenticated,
                user: result.user,
                serverUrl: result.serverUrl
            }, viewType, windowId);
            this.context.postMessage({
                command: 'configurationResponse',
                configurationData: await this.configService.loadConfiguration()
            }, viewType, windowId);
        } catch (error) {
            console.error('获取认证状态失败:', error);
            this.context.postMessage({
                command: 'authStatusResponse',
                isAuthenticated: false,
                user: null
            }, viewType, windowId);
        }
    }

    private async handleLogin(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            // authUrl notification is handled by ChatProvider (opens browser via vscode.env.openExternal)
            const result = await this.utilityClient.request('login') as {
                user: { id: string; email?: string } | undefined;
            };

            this.context.postMessage({
                command: 'loginResponse',
                success: true,
                user: result.user
            }, viewType, windowId);

            // After successful login, reinitialize all sessions to pick up SSO config
            const updatedConfig = await this.configService.loadConfiguration();
            this.context.updateAllSessionsConfig(updatedConfig);
        } catch (error) {
            console.error('登录失败:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.context.postMessage({
                command: 'loginResponse',
                success: false,
                error: errorMessage
            }, viewType, windowId);
        }
    }

    private async handleLogout(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        try {
            await this.utilityClient.request('logout');

            this.context.postMessage({
                command: 'logoutResponse',
                success: true
            }, viewType, windowId);

            // After logout, reinitialize all sessions to revert to direct LLM mode
            const config = await this.configService.loadConfiguration();
            this.context.updateAllSessionsConfig(config);
        } catch (error) {
            console.error('登出失败:', error);
            this.context.postMessage({
                command: 'logoutResponse',
                success: false,
                error: String(error)
            }, viewType, windowId);
        }
    }

    private async handleGetStatus(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        const config = await this.configService.loadConfiguration();
        const version = this.context.getVersion();

        this.context.postMessage({
            command: 'statusResponse',
            version,
            sessionId: session.sessionId || '',
            // Session root (initialize-time cwd), not the subdir the agent
            // bash-cd'd into — matches where @file search is anchored.
            workdir: session.agent?.sessionCwd || session.agent?.workingDirectory || '',
            configurationData: config
        }, viewType, windowId);
    }

    private async handleGetMcpServers(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        const servers = await session.getMcpServers();
        this.context.postMessage({
            command: 'mcpServersResponse',
            servers
        }, viewType, windowId);
    }

    private async handleGetSubagentConfigurations(viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        const configurations = await session.getSubagentConfigurations();
        this.context.postMessage({
            command: 'subagentConfigurationsResponse',
            configurations
        }, viewType, windowId);
    }

    private async handleConnectMcpServer(serverName: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            const success = await session.connectMcpServer(serverName);
            // SDK's onMcpServersChange callback will push the updated state to frontend
            if (success) {
                vscode.window.showInformationMessage(`MCP 服务器 "${serverName}" 连接请求已发送`);
            }
        } catch (error) {
            console.error('连接 MCP 服务器失败:', error);
            vscode.window.showErrorMessage('连接 MCP 服务器失败: ' + error);
        }
    }

    private async handleDisconnectMcpServer(serverName: string, viewType?: 'sidebar' | 'tab' | 'window', windowId?: string) {
        const session = this.context.getChatSession(viewType || 'tab', windowId);
        try {
            const success = await session.disconnectMcpServer(serverName);
            // SDK's onMcpServersChange callback will push the updated state to frontend
            if (success) {
                vscode.window.showInformationMessage(`MCP 服务器 "${serverName}" 断开请求已发送`);
            }
        } catch (error) {
            console.error('断开 MCP 服务器失败:', error);
            vscode.window.showErrorMessage('断开 MCP 服务器失败: ' + error);
        }
    }
}
