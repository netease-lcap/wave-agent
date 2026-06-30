import * as vscode from 'vscode';
import { 
    PluginCore,
    Scope 
} from 'wave-agent-sdk';

export class PluginService {
    private pluginCore: PluginCore;

    constructor() {
        this.pluginCore = new PluginCore(this.getWorkdir());
    }

    private getWorkdir(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    public async listPlugins() {
        const { plugins } = await this.pluginCore.listPlugins();
        const mergedEnabled = this.pluginCore.getMergedEnabledPlugins();

        return plugins.map((p) => {
            const pluginId = `${p.name}@${p.marketplace}`;
            return {
                id: pluginId,
                name: p.name,
                description: p.description,
                marketplace: p.marketplace,
                installed: p.installed,
                version: p.version,
                enabled: mergedEnabled[pluginId] !== false,
                scope: p.scope
            };
        });
    }

    public async installPlugin(pluginId: string, scope?: Scope) {
        return await this.pluginCore.installPlugin(pluginId, scope);
    }

    public async uninstallPlugin(pluginId: string) {
        await this.pluginCore.uninstallPlugin(pluginId);
    }

    public async enablePlugin(pluginId: string, scope?: Scope) {
        await this.pluginCore.enablePlugin(pluginId, scope);
    }

    public async disablePlugin(pluginId: string, scope?: Scope) {
        await this.pluginCore.disablePlugin(pluginId, scope);
    }

    public async updatePlugin(pluginId: string) {
        return await this.pluginCore.updatePlugin(pluginId);
    }

    public async listMarketplaces() {
        return await this.pluginCore.listMarketplaces();
    }

    public async addMarketplace(input: string) {
        return await this.pluginCore.addMarketplace(input);
    }

    public async removeMarketplace(name: string) {
        return await this.pluginCore.removeMarketplace(name);
    }

    public async updateMarketplace(name?: string) {
        return await this.pluginCore.updateMarketplace(name);
    }
}
