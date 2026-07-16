/**
 * PluginDialog - Plugin management dialog
 *
 * Opened via the /plugin slash command. Contains three sub-tabs:
 * explore, installed, and marketplaces.
 */

import React, { useState, useEffect, useRef } from 'react';
import { PluginDialogProps, PluginInfo, MarketplaceInfo, PluginScope } from '../types';
import '../styles/ConfigurationDialog.css';

const PluginDialog: React.FC<PluginDialogProps & { vscode: { postMessage: (msg: unknown) => void } }> = ({
  onClose,
  vscode
}) => {
  const [activePluginTab, setActivePluginTab] = useState<'explore' | 'installed' | 'marketplaces'>('explore');

  // Plugin state
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([]);
  const [newMarketplaceUrl, setNewMarketplaceUrl] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState<PluginInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch data on mount and when sub-tab changes
  useEffect(() => {
    if (activePluginTab === 'explore' || activePluginTab === 'installed') {
      vscode?.postMessage({ command: 'listPlugins' });
    } else if (activePluginTab === 'marketplaces') {
      vscode?.postMessage({ command: 'listMarketplaces' });
    }
    setSearchQuery('');
    setSelectedPlugin(null);
  }, [activePluginTab, vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case 'listPluginsResponse':
          setPlugins(message.plugins || []);
          break;
        case 'listMarketplacesResponse':
          setMarketplaces(message.marketplaces || []);
          break;
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleInstallPlugin = (pluginId: string, scope: PluginScope) => {
    vscode?.postMessage({ command: 'installPlugin', pluginId, scope });
    setSelectedPlugin(null);
  };

  const handleUninstallPlugin = (pluginId: string) => {
    vscode?.postMessage({ command: 'uninstallPlugin', pluginId });
  };

  const handleUpdatePlugin = (pluginId: string) => {
    vscode?.postMessage({ command: 'updatePlugin', pluginId });
  };

  const handleAddMarketplace = () => {
    if (newMarketplaceUrl) {
      vscode?.postMessage({ command: 'addMarketplace', input: newMarketplaceUrl });
      setNewMarketplaceUrl('');
    }
  };

  const handleRemoveMarketplace = (name: string) => {
    vscode?.postMessage({ command: 'removeMarketplace', name });
  };

  const handleUpdateMarketplace = (name?: string) => {
    vscode?.postMessage({ command: 'updateMarketplace', name });
  };

  const filteredPlugins = plugins.filter(p => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || (p.description?.toLowerCase().includes(q));
  });

  const dialogRef = useRef<HTMLDivElement>(null);

  // Handle clicking outside to close dialog
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [onClose]);

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog"
      >
        <div className="configuration-dialog-header">
          <h3>插件管理</h3>
        </div>

        <div className="plugins-container">
          <div className="plugin-tabs">
            <button
              className={`plugin-tab ${activePluginTab === 'explore' ? 'active' : ''}`}
              onClick={() => setActivePluginTab('explore')}
            >
              探索新插件
            </button>
            <button
              className={`plugin-tab ${activePluginTab === 'installed' ? 'active' : ''}`}
              onClick={() => setActivePluginTab('installed')}
            >
              已安装插件
            </button>
            <button
              className={`plugin-tab ${activePluginTab === 'marketplaces' ? 'active' : ''}`}
              onClick={() => setActivePluginTab('marketplaces')}
            >
              插件市场
            </button>
          </div>

          <div className="plugin-content">
            {activePluginTab === 'explore' && (
              <div className="explore-plugins">
                {selectedPlugin ? (
                  <div className="plugin-detail">
                    <button className="back-button" onClick={() => { setSelectedPlugin(null); setSearchQuery(''); }}>
                      ← 返回列表
                    </button>
                    <div className="plugin-detail-header">
                      <div className="plugin-name">{selectedPlugin.name}</div>
                      {selectedPlugin.version && (
                        <div className="plugin-version">版本 {selectedPlugin.version}</div>
                      )}
                    </div>
                    {selectedPlugin.description && (
                      <div className="plugin-description">{selectedPlugin.description}</div>
                    )}
                    {selectedPlugin.marketplace && (
                      <div className="plugin-marketplace">来自市场: {selectedPlugin.marketplace}</div>
                    )}
                    <div className="install-options">
                      <h4>选择安装作用域</h4>
                      <button
                        className="install-option-btn"
                        onClick={() => handleInstallPlugin(selectedPlugin.id, 'user')}
                      >
                        <div className="install-option-title">为你安装 (user)</div>
                        <div className="install-option-desc">仅在你的用户配置中安装此插件</div>
                      </button>
                      <button
                        className="install-option-btn"
                        onClick={() => handleInstallPlugin(selectedPlugin.id, 'project')}
                      >
                        <div className="install-option-title">为此仓库的所有协作者安装 (project)</div>
                        <div className="install-option-desc">在项目配置中安装，团队成员共享</div>
                      </button>
                      <button
                        className="install-option-btn"
                        onClick={() => handleInstallPlugin(selectedPlugin.id, 'local')}
                      >
                        <div className="install-option-title">仅为你在此仓库中安装 (local)</div>
                        <div className="install-option-desc">仅在本地仓库配置中安装，不影响其他项目</div>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="explore-list">
                    <div className="plugin-search">
                      <input
                        type="text"
                        placeholder="搜索插件..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>
                    <div className="plugin-list">
                      {filteredPlugins.length > 0 ? (
                        filteredPlugins.map(plugin => (
                          <div
                            key={plugin.id}
                            className="plugin-item clickable"
                            onClick={() => setSelectedPlugin(plugin)}
                          >
                            <div className="plugin-info">
                              <div className="plugin-name">
                                {plugin.name} <span className="plugin-version">{plugin.version}</span>
                                {plugin.installed && plugin.scope && <span className="plugin-scope">[{plugin.scope}]</span>}
                              </div>
                              <div className="plugin-desc">{plugin.description}</div>
                              <div className="plugin-market">来自: {plugin.marketplace}</div>
                            </div>
                            <div className="plugin-chevron">›</div>
                          </div>
                        ))
                      ) : (
                        <div className="empty-state">
                          {searchQuery ? '没有找到匹配的插件' : '没有可探索的插件'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activePluginTab === 'installed' && (
              <div className="installed-plugins">
                <div className="plugin-list">
                  {plugins.filter(p => p.installed && p.scope).length > 0 ? (
                    plugins.filter(p => p.installed && p.scope).map(plugin => (
                      <div key={plugin.id} className="plugin-item">
                        <div className="plugin-info">
                          <div className="plugin-name">
                            {plugin.name}
                            <span className="plugin-version">{plugin.version}</span>
                            {plugin.scope && <span className="plugin-scope">[{plugin.scope}]</span>}
                          </div>
                          <div className="plugin-desc">{plugin.description}</div>
                        </div>
                        <div className="plugin-actions">
                          <button
                            className="update-btn"
                            onClick={() => handleUpdatePlugin(plugin.id)}
                            title="更新插件"
                          >
                            更新
                          </button>
                          <button
                            className="uninstall-btn"
                            onClick={() => handleUninstallPlugin(plugin.id)}
                            title="卸载插件"
                          >
                            卸载
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">没有已激活的插件</div>
                  )}
                </div>
              </div>
            )}

            {activePluginTab === 'marketplaces' && (
              <div className="marketplaces-manager">
                <div className="add-marketplace">
                  <input
                    type="text"
                    placeholder="市场 URL (本地路径, owner/repo, 或 Git URL)"
                    value={newMarketplaceUrl}
                    onChange={(e) => setNewMarketplaceUrl(e.target.value)}
                  />
                  <button className="add-btn" onClick={handleAddMarketplace}>添加</button>
                </div>
                <div className="marketplace-list">
                  {marketplaces.length > 0 ? (
                    marketplaces.map(m => (
                      <div key={m.name} className="marketplace-item">
                        <div className="marketplace-info">
                          <div className="marketplace-name">{m.name}</div>
                          <div className="marketplace-url">{m.url}</div>
                        </div>
                        <div className="marketplace-actions">
                          <button onClick={() => handleUpdateMarketplace(m.name)}>更新</button>
                          <button onClick={() => handleRemoveMarketplace(m.name)}>移除</button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">没有已注册的市场</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="configuration-actions">
            <button
              type="button"
              onClick={onClose}
              className="configuration-cancel-btn"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PluginDialog;
