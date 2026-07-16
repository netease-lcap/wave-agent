import * as vscode from 'vscode';
import type { Scope } from 'wave-agent-sdk';
import type { StdioClient } from '../stdio/stdioClient';

export class PluginService {
    constructor(private utilityClient: StdioClient) {}

    private getWorkdir(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    public async listPlugins() {
        const result = await this.utilityClient.request('listPlugins', { workdir: this.getWorkdir() }) as { plugins: Array<Record<string, unknown>> };
        return result.plugins;
    }

    public async installPlugin(pluginId: string, scope?: Scope) {
        return await this.utilityClient.request('installPlugin', { pluginId, scope, workdir: this.getWorkdir() });
    }

    public async uninstallPlugin(pluginId: string) {
        await this.utilityClient.request('uninstallPlugin', { pluginId, workdir: this.getWorkdir() });
    }

    public async enablePlugin(pluginId: string, scope?: Scope) {
        await this.utilityClient.request('enablePlugin', { pluginId, scope, workdir: this.getWorkdir() });
    }

    public async disablePlugin(pluginId: string, scope?: Scope) {
        await this.utilityClient.request('disablePlugin', { pluginId, scope, workdir: this.getWorkdir() });
    }

    public async updatePlugin(pluginId: string) {
        return await this.utilityClient.request('updatePlugin', { pluginId, workdir: this.getWorkdir() });
    }

    public async listMarketplaces() {
        return await this.utilityClient.request('listMarketplaces', { workdir: this.getWorkdir() });
    }

    public async addMarketplace(input: string) {
        return await this.utilityClient.request('addMarketplace', { input, workdir: this.getWorkdir() });
    }

    public async removeMarketplace(name: string) {
        await this.utilityClient.request('removeMarketplace', { name, workdir: this.getWorkdir() });
    }

    public async updateMarketplace(name?: string) {
        await this.utilityClient.request('updateMarketplace', { name, workdir: this.getWorkdir() });
    }
}
