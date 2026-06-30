import * as vscode from 'vscode';
import { listSessions, SessionMetadata } from 'wave-agent-sdk';

export class SessionService {
    public async getSessionsList(): Promise<SessionMetadata[]> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const workdir = workspaceFolder?.uri.fsPath || process.cwd();

            const allSessions = await listSessions(workdir);
            
            // Filter to get only main sessions and slice to get only first 10 sessions
            return allSessions
                .filter(session => session.sessionType === 'main')
                .slice(0, 10);
        } catch (error) {
            console.error(`获取会话列表失败:`, error);
            throw error;
        }
    }
}
