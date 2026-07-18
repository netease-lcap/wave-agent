import * as vscode from 'vscode';
import type { SessionMetadata } from 'wave-agent-sdk';
import type { StdioClient } from '../stdio/stdioClient';

export class SessionService {
    constructor(private utilityClient: StdioClient) {}

    public async getSessionsList(): Promise<SessionMetadata[]> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const workdir = workspaceFolder?.uri.fsPath || process.cwd();

            const result = await this.utilityClient.request('listSessions', { workdir }) as { sessions: SessionMetadata[] };
            const allSessions = result.sessions;

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
