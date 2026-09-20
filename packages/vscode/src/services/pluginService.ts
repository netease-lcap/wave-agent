import * as vscode from "vscode";
import type { Scope } from "wave-agent-sdk/host";
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

  /**
   * 卸载插件：作用域随请求下发，只卸载该作用域（spec plugin A-015）；
   * 缺省时由 SDK 按当前目录探测生效作用域。
   */
  public async uninstallPlugin(pluginId: string, scope?: Scope) {
    await this.utilityClient.request("uninstallPlugin", {
      pluginId,
      scope,
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
   * 刷新各市场检出（只拉清单、不升级插件）。打开设置页插件市场视图时在后台
   * 调用（spec 插件市场 A-013 场景 5）。
   */
  public async refreshMarketplaces() {
    await this.utilityClient.request("refreshMarketplaces", {
      workdir: this.getWorkdir(),
    });
  }

  /**
   * 插件就地重载：让该 CLI 进程把它托管的全部 live 会话按磁盘上的插件状态就地
   * 换装（不重建会话、不打断正在生成的回合，docs/specs/ecosystem/plugin.md
   * 「插件变更的就地重载」）。返回失败清单供宿主如实提示，失败不回滚。
   */
  public async reloadPlugins() {
    return (await this.utilityClient.request("reloadPlugins")) as {
      plugins: string[];
      failures: Array<{ path: string; error: string }>;
    };
  }

  /**
   * 批量更新插件：按当前清单把该市场内已安装插件升级到最新，不拉取检出
   * （清单刷新由打开插件市场视图时的 refreshMarketplaces 承担，spec A-013）。
   * 返回实际升级的插件数（0 = 已是最新），宿主据此提示。
   */
  public async updateMarketplace(name?: string) {
    return (await this.utilityClient.request("updateMarketplace", {
      name,
      workdir: this.getWorkdir(),
    })) as { updated: number };
  }
}
