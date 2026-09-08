import * as vscode from "vscode";
import type { SessionMetadata } from "wave-agent-sdk/types";
import type { StdioClient } from "../stdio/stdioClient";

export class SessionService {
  constructor(private utilityClient: StdioClient) {}

  public async getSessionsList(): Promise<SessionMetadata[]> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const workdir = workspaceFolder?.uri.fsPath || process.cwd();

      const result = (await this.utilityClient.request("listSessions", {
        workdir,
      })) as { sessions: SessionMetadata[] };
      const allSessions = result.sessions;

      // The SDK already returns only main sessions (subagent files are
      // excluded by filename), sorted by lastActiveAt descending. Keep the
      // explicit main filter as a defensive guard and return the full list —
      // the history popup has no pagination, so capping here would make
      // older sessions unreachable from the UI.
      return allSessions.filter((session) => session.sessionType === "main");
    } catch (error) {
      console.error(`获取会话列表失败:`, error);
      throw error;
    }
  }
}
