import * as vscode from "vscode";
import type { Scope } from "wave-agent-sdk/types";
import type { StdioClient } from "../stdio/stdioClient";

export class PluginService {
  constructor(private utilityClient: StdioClient) {}

  /** Workspace root the plugin/project-settings RPCs run against. Reply
   *  attribution: hosts echo it on projectSettings so the webview can drop
   *  stale replies (webview-fixtures ReplyAttribution). */
  public getWorkdir(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  public async listPlugins() {
    const result = (await this.utilityClient.request("listPlugins", {
      workdir: this.getWorkdir(),
    })) as { plugins: Array<Record<string, unknown>> };
    return result.plugins;
  }

  public async installPlugin(pluginId: string, scope?: Scope) {
    return await this.utilityClient.request("installPlugin", {
      pluginId,
      scope,
      workdir: this.getWorkdir(),
    });
  }

  public async uninstallPlugin(pluginId: string) {
    await this.utilityClient.request("uninstallPlugin", {
      pluginId,
      workdir: this.getWorkdir(),
    });
  }

  public async enablePlugin(pluginId: string, scope?: Scope) {
    await this.utilityClient.request("enablePlugin", {
      pluginId,
      scope,
      workdir: this.getWorkdir(),
    });
  }

  public async disablePlugin(pluginId: string, scope?: Scope) {
    await this.utilityClient.request("disablePlugin", {
      pluginId,
      scope,
      workdir: this.getWorkdir(),
    });
  }

  public async getProjectSettings() {
    return (await this.utilityClient.request("getProjectSettings", {
      workdir: this.getWorkdir(),
    })) as { enabledPlugins: Record<string, boolean> };
  }

  public async setBuiltinPluginEnabled(
    pluginId: string,
    enabled: boolean,
    scope?: Scope,
  ) {
    return (await this.utilityClient.request("setBuiltinPluginEnabled", {
      pluginId,
      enabled,
      scope,
      workdir: this.getWorkdir(),
    })) as { enabledPlugins: Record<string, boolean> };
  }

  public async updatePlugin(pluginId: string) {
    return await this.utilityClient.request("updatePlugin", {
      pluginId,
      workdir: this.getWorkdir(),
    });
  }

  /**
   * 更换安装作用域：清除该插件在各作用域的启用记录，再在目标作用域启用
   * （设置页插件市场「更换安装作用域」）。
   */
  public async setPluginScope(pluginId: string, scope: Scope) {
    return await this.utilityClient.request("setPluginScope", {
      pluginId,
      scope,
      workdir: this.getWorkdir(),
    });
  }

  public async listMarketplaces() {
    return await this.utilityClient.request("listMarketplaces", {
      workdir: this.getWorkdir(),
    });
  }

  public async addMarketplace(input: string) {
    return await this.utilityClient.request("addMarketplace", {
      input,
      workdir: this.getWorkdir(),
    });
  }

  public async removeMarketplace(name: string) {
    await this.utilityClient.request("removeMarketplace", {
      name,
      workdir: this.getWorkdir(),
    });
  }

  /**
   * 更新市场（拉取最新市场源），同时把该市场内已安装插件升级到最新。
   * 返回实际升级的插件数（0 = 已是最新），宿主据此提示。
   */
  public async updateMarketplace(name?: string) {
    return (await this.utilityClient.request("updateMarketplace", {
      name,
      workdir: this.getWorkdir(),
    })) as { updated: number };
  }
}
