import * as vscode from 'vscode';
import { ChatProvider } from './chatProvider';
import { checkAndNotify } from './services/updateService';

let chatProvider: ChatProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Wave AI 聊天扩展已激活！');

    // Create a single ChatProvider instance for the extension lifecycle
    chatProvider = new ChatProvider(context);

    // Check for updates asynchronously (non-blocking)
    checkAndNotify(context).catch(err => {
        console.warn('[UpdateService] Update check failed:', err);
    });

    // Register sidebar command
    const openChatSidebarCommand = vscode.commands.registerCommand('wave-code.openChatSidebar', async () => {
        await openChatWithProgress('sidebar');
    });

    // Register new tab command (main shortcut)
    const openChatTabCommand = vscode.commands.registerCommand('wave-code.openChatTab', async () => {
        await openChatWithProgress('tab');
    });

    // Register new window command
    const openChatWindowCommand = vscode.commands.registerCommand('wave-code.openChatWindow', async () => {
        await openChatWithProgress('window');
    });

    // Register focus view command
    const focusViewCommand = vscode.commands.registerCommand('wave-code.focusView', async () => {
        try {
            await chatProvider!.focusView();
        } catch (error) {
            console.error('聚焦视图时出错:', error);
            vscode.window.showErrorMessage('聚焦视图失败: ' + error);
        }
    });

    // Register add to wave command
    const addToWaveCommand = vscode.commands.registerCommand('wave-code.addToWave', async () => {
        try {
            await chatProvider!.addToWave();
        } catch (error) {
            console.error('添加到 Wave 时出错:', error);
            vscode.window.showErrorMessage('添加到 Wave 失败: ' + error);
        }
    });

    // Register check for updates command
    const checkUpdatesCommand = vscode.commands.registerCommand('wave-code.checkForUpdates', async () => {
        try {
            await checkAndNotify(context, true);
        } catch (error) {
            console.error('检查更新时出错:', error);
            vscode.window.showErrorMessage('检查更新失败: ' + error);
        }
    });

    async function openChatWithProgress(mode: 'sidebar' | 'tab' | 'window') {
        try {
            // Show progress indicator while opening chat
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在打开 Wave AI 聊天(${mode === 'sidebar' ? '侧边栏' : mode === 'tab' ? '标签页' : '新窗口'})...`,
                cancellable: false
            }, async () => {
                await chatProvider!.createOrShowChatPanel(mode);
            });
        } catch (error) {
            console.error('打开聊天时出错:', error);
            vscode.window.showErrorMessage('打开聊天失败: ' + error);
        }
    }

    context.subscriptions.push(
        openChatSidebarCommand,
        openChatTabCommand,
        openChatWindowCommand,
        focusViewCommand,
        addToWaveCommand,
        checkUpdatesCommand
    );
    
    console.log('Wave 聊天命令注册成功');
}

export async function deactivate() {
    console.log('Wave AI 聊天扩展正在停用');
    
    // Clean up the chat provider and its agent
    if (chatProvider) {
        await chatProvider.destroy();
        chatProvider = undefined;
    }
    
    console.log('Wave AI 聊天扩展已停用');
}