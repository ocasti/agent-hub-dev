import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Plugin, CatalogPlugin, PluginConfigField, LicenseLimits, PluginCompatResult } from '../lib/types';
import {
  getPlugins,
  uninstallPlugin,
  updatePluginConfig,
  getPluginCatalog,
  installCatalogPlugin,
  checkPluginCompatibility,
  previewLocalPlugin,
  installPluginFromDisk,
  fetchPluginConfigOptions,
} from '../lib/ipc';
import UpgradePrompt from './ui/UpgradePrompt';

type Tab = 'installed' | 'marketplace' | 'local';

interface LocalPluginPreview {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  capabilities: string[];
  level: 1 | 2;
  configSchema?: PluginConfigField[];
}

const CATEGORIES = ['All', 'Code Hosting', 'PM Tools', 'Notifications', 'CI/CD', 'Documentation', 'Other'];

interface PluginsViewProps {
  licenseLimits?: LicenseLimits;
  onOpenLogin?: () => void;
}

export default function PluginsView({ licenseLimits, onOpenLogin }: PluginsViewProps = {}) {
  const { t } = useTranslation('plugins');
  const [tab, setTab] = useState<Tab>('installed');
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [catalog, setCatalog] = useState<CatalogPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [installing, setInstalling] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [compatResults, setCompatResults] = useState<PluginCompatResult[]>([]);
  const [localFolderPath, setLocalFolderPath] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<LocalPluginPreview | null>(null);
  const [localConfigValues, setLocalConfigValues] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [localInstalling, setLocalInstalling] = useState(false);

  useEffect(() => {
    loadPlugins();
    loadCatalog(false);
    loadCompatibility();
  }, []);

  const loadCompatibility = async () => {
    try {
      const results = await checkPluginCompatibility();
      setCompatResults(results);
    } catch {
      // ignore
    }
  };

  const loadPlugins = async () => {
    setLoading(true);
    try {
      const data = await getPlugins();
      setPlugins(data);
    } catch (err) {
      console.error('[PluginsView] Failed to load plugins:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadCatalog = async (forceRefresh: boolean) => {
    setCatalogLoading(true);
    try {
      const data = await getPluginCatalog(forceRefresh);
      setCatalog(data);
    } catch (err) {
      console.error('[PluginsView] Failed to load catalog:', err);
    } finally {
      setCatalogLoading(false);
    }
  };

  const installedIds = useMemo(() => new Set(plugins.map((p) => p.id)), [plugins]);

  const filteredCatalog = useMemo(() => {
    let items = catalog;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.author.toLowerCase().includes(q) ||
          p.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    if (category !== 'All') {
      items = items.filter((p) => p.category === category);
    }
    return items;
  }, [catalog, search, category]);

  const handleUninstall = async (pluginId: string) => {
    try {
      await uninstallPlugin(pluginId);
      await loadPlugins();
    } catch (err) {
      console.error('[PluginsView] Uninstall failed:', err);
    }
  };

  const handleSaveConfig = async (pluginId: string) => {
    try {
      await updatePluginConfig(pluginId, configValues);
      setConfiguring(null);
      setConfigValues({});
      await loadPlugins();
    } catch (err) {
      console.error('[PluginsView] Config update failed:', err);
    }
  };

  const openConfig = (plugin: Plugin) => {
    setConfiguring(plugin.id);
    setConfigValues({ ...plugin.config });
  };

  const handleCatalogInstall = async (catalogPlugin: CatalogPlugin) => {
    // If config schema exists, show config form first
    if (catalogPlugin.configSchema && catalogPlugin.configSchema.length > 0 && configuring !== catalogPlugin.id) {
      setConfiguring(catalogPlugin.id);
      setConfigValues(
        Object.fromEntries(catalogPlugin.configSchema.map((f) => [f.key, f.default || '']))
      );
      return;
    }

    setInstalling(catalogPlugin.id);
    setError(null);
    try {
      await installCatalogPlugin(catalogPlugin.id, configValues);
      setConfiguring(null);
      setConfigValues({});
      await loadPlugins();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setInstalling(null);
    }
  };

  const getUpdateAvailable = (pluginId: string): CatalogPlugin | undefined => {
    const installed = plugins.find((p) => p.id === pluginId);
    const catalogEntry = catalog.find((c) => c.id === pluginId);
    if (installed && catalogEntry && installed.version !== catalogEntry.version) {
      return catalogEntry;
    }
    return undefined;
  };

  const handleUpdate = async (catalogEntry: CatalogPlugin) => {
    setInstalling(catalogEntry.id);
    setError(null);
    try {
      const existing = plugins.find((p) => p.id === catalogEntry.id);
      await installCatalogPlugin(catalogEntry.id, existing?.config || {});
      await loadPlugins();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setInstalling(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('title', 'Plugins')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {t('subtitle', 'Extend Agent Hub with integrations for code hosting, PM tools, notifications, and more.')}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setTab('installed')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'installed'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          {t('installed', 'Installed')} ({plugins.length})
        </button>
        <button
          onClick={() => setTab('marketplace')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'marketplace'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          {t('marketplace', 'Marketplace')} ({catalog.length})
        </button>
        <button
          onClick={() => setTab('local')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'local'
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          {t('loadFromDisk', 'Load from Disk')}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm text-red-600 dark:text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-2">&times;</button>
        </div>
      )}

      {/* ── Installed tab ── */}
      {tab === 'installed' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plugins.map((plugin) => {
              const update = getUpdateAvailable(plugin.id);
              const compat = compatResults.find((c) => c.pluginId === plugin.id);
              const isIncompatible = compat && !compat.compatible;
              return (
                <div
                  key={plugin.id}
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{plugin.name}</h3>
                        <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">v{plugin.version}</span>
                        {plugin.source === 'official' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium">
                            {t('official', 'Official')}
                          </span>
                        )}
                        {plugin.source === 'local' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 font-medium">
                            {t('local', 'Local')}
                          </span>
                        )}
                        {isIncompatible && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-medium">
                            {t('incompatible', 'Incompatible')}
                          </span>
                        )}
                      </div>
                      {plugin.author && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('by', 'by')} {plugin.author}</p>
                      )}
                    </div>
                    <span className={`w-2 h-2 rounded-full mt-1 ${isIncompatible ? 'bg-red-400' : plugin.enabled ? 'bg-emerald-400' : 'bg-gray-300 dark:bg-gray-600'}`} />
                  </div>

                  <p className="text-xs text-gray-600 dark:text-gray-400">{plugin.description}</p>

                  <div className="flex flex-wrap gap-1">
                    {plugin.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-medium"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>

                  {/* Config panel */}
                  {configuring === plugin.id && plugin.configSchema && (
                    <ConfigForm
                      fields={plugin.configSchema}
                      values={configValues}
                      onChange={setConfigValues}
                      onSave={() => handleSaveConfig(plugin.id)}
                      onCancel={() => { setConfiguring(null); setConfigValues({}); }}
                      t={t}
                    />
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    {plugin.configSchema && plugin.configSchema.length > 0 && configuring !== plugin.id && (
                      <button
                        onClick={() => openConfig(plugin)}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {t('configure', 'Configure')}
                      </button>
                    )}
                    {update && (
                      <button
                        onClick={() => handleUpdate(update)}
                        disabled={installing === plugin.id}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {installing === plugin.id ? t('updating', 'Updating...') : t('update', 'Update to v') + update.version}
                      </button>
                    )}
                    {catalog.find((c) => c.id === plugin.id)?.homepage && (
                      <a
                        href={catalog.find((c) => c.id === plugin.id)!.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        {t('viewDocs', 'Docs')}
                      </a>
                    )}
                    <button
                      onClick={() => handleUninstall(plugin.id)}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      {t('uninstall', 'Uninstall')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {plugins.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm text-gray-400 dark:text-gray-500">
                {t('noPlugins', 'No plugins installed. Browse the marketplace to add integrations.')}
              </p>
              <button
                onClick={() => setTab('marketplace')}
                className="mt-3 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {t('goToMarketplace', 'Go to Marketplace')}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Marketplace tab ── */}
      {tab === 'marketplace' && (
        <>
          {/* Search + Refresh */}
          <div className="flex gap-3 items-center">
            <div className="relative flex-1">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchPlugins', 'Search plugins...')}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button
              onClick={() => loadCatalog(true)}
              disabled={catalogLoading}
              className="px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              {catalogLoading ? (
                <span className="flex items-center gap-1.5">
                  <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  {t('refreshing', 'Refreshing...')}
                </span>
              ) : (
                t('refresh', 'Refresh')
              )}
            </button>
          </div>

          {/* Category pills */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                  category === cat
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Plugin grid */}
          {catalogLoading && catalog.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredCatalog.map((cp) => {
                const isInstalled = installedIds.has(cp.id);
                const isInstalling = installing === cp.id;
                const isConfiguring = configuring === cp.id;

                return (
                  <div
                    key={cp.id}
                    className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{cp.name}</h3>
                          <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">v{cp.version}</span>
                          {cp.source === 'official' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium">
                              {t('official', 'Official')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('by', 'by')} {cp.author}</p>
                      </div>
                    </div>

                    <p className="text-xs text-gray-600 dark:text-gray-400">{cp.description}</p>

                    <div className="flex flex-wrap gap-1">
                      {cp.capabilities.map((cap) => (
                        <span
                          key={cap}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-medium"
                        >
                          {cap}
                        </span>
                      ))}
                      {cp.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* Inline config form for install */}
                    {isConfiguring && cp.configSchema && (
                      <ConfigForm
                        fields={cp.configSchema}
                        values={configValues}
                        onChange={setConfigValues}
                        onSave={() => handleCatalogInstall(cp)}
                        onCancel={() => { setConfiguring(null); setConfigValues({}); }}
                        saveLabel={t('installPlugin', 'Install')}
                        t={t}
                      />
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      {isInstalled ? (
                        <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                          {t('installedBadge', 'Installed')}
                        </span>
                      ) : cp.source === 'community' && licenseLimits && !licenseLimits.community_plugins ? (
                        <UpgradePrompt
                          feature={t('communityPlugins', 'Community plugins')}
                          onLogin={() => onOpenLogin?.()}
                          compact
                        />
                      ) : !isConfiguring ? (
                        <button
                          onClick={() => handleCatalogInstall(cp)}
                          disabled={isInstalling}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {isInstalling ? (
                            <span className="flex items-center gap-1.5">
                              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              {t('installing', 'Installing...')}
                            </span>
                          ) : (
                            t('installPlugin', 'Install')
                          )}
                        </button>
                      ) : null}
                      {cp.homepage && (
                        <a
                          href={cp.homepage}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          {t('viewDocs', 'Docs')}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!catalogLoading && filteredCatalog.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm text-gray-400 dark:text-gray-500">
                {catalog.length === 0
                  ? t('noCatalog', 'No plugins available in the marketplace yet. Try refreshing.')
                  : t('noResults', 'No plugins match your search.')}
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Load from Disk tab ── */}
      {tab === 'local' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('localDescription', 'Install a plugin from a local folder. The folder must contain a valid plugin.json file.')}
          </p>

          {/* Browse button */}
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                setLocalError(null);
                setLocalPreview(null);
                setLocalConfigValues({});
                try {
                  const folder = await window.electronAPI.selectFolder();
                  if (!folder) return;
                  setLocalFolderPath(folder);
                  const preview = await previewLocalPlugin(folder);
                  setLocalPreview(preview);
                  if (preview.configSchema) {
                    setLocalConfigValues(
                      Object.fromEntries(preview.configSchema.map((f) => [f.key, f.default || '']))
                    );
                  }
                } catch (err) {
                  setLocalError(err instanceof Error ? err.message : 'Failed to load plugin');
                }
              }}
              className="px-4 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600"
            >
              {t('browseFolder', 'Browse Folder...')}
            </button>
            {localFolderPath && (
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-md">
                {localFolderPath}
              </span>
            )}
          </div>

          {/* Error display */}
          {localError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm text-red-600 dark:text-red-400 flex items-center justify-between">
              <span>{localError}</span>
              <button onClick={() => setLocalError(null)} className="text-red-400 hover:text-red-600 ml-2">&times;</button>
            </div>
          )}

          {/* Preview card */}
          {localPreview && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-3 max-w-lg">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{localPreview.name}</h3>
                  <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">v{localPreview.version}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-medium">
                    {t('valid', 'Valid')}
                  </span>
                </div>
                {localPreview.author && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('by', 'by')} {localPreview.author}</p>
                )}
              </div>

              <p className="text-xs text-gray-600 dark:text-gray-400">{localPreview.description}</p>

              <div className="flex flex-wrap gap-1">
                {localPreview.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-medium"
                  >
                    {cap}
                  </span>
                ))}
              </div>

              {/* Config form */}
              {localPreview.configSchema && localPreview.configSchema.length > 0 && (
                <ConfigForm
                  fields={localPreview.configSchema}
                  values={localConfigValues}
                  onChange={setLocalConfigValues}
                  onSave={async () => {
                    if (!localFolderPath) return;
                    setLocalInstalling(true);
                    setLocalError(null);
                    try {
                      await installPluginFromDisk(localFolderPath, localConfigValues);
                      setLocalPreview(null);
                      setLocalFolderPath(null);
                      setLocalConfigValues({});
                      await loadPlugins();
                      setTab('installed');
                    } catch (err) {
                      setLocalError(err instanceof Error ? err.message : 'Install failed');
                    } finally {
                      setLocalInstalling(false);
                    }
                  }}
                  onCancel={() => { setLocalPreview(null); setLocalFolderPath(null); setLocalConfigValues({}); }}
                  saveLabel={localInstalling ? t('installing', 'Installing...') : t('installPlugin', 'Install')}
                  t={t}
                />
              )}

              {/* Install button (no config) */}
              {(!localPreview.configSchema || localPreview.configSchema.length === 0) && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={async () => {
                      if (!localFolderPath) return;
                      setLocalInstalling(true);
                      setLocalError(null);
                      try {
                        await installPluginFromDisk(localFolderPath, {});
                        setLocalPreview(null);
                        setLocalFolderPath(null);
                        await loadPlugins();
                        setTab('installed');
                      } catch (err) {
                        setLocalError(err instanceof Error ? err.message : 'Install failed');
                      } finally {
                        setLocalInstalling(false);
                      }
                    }}
                    disabled={localInstalling}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {localInstalling ? (
                      <span className="flex items-center gap-1.5">
                        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        {t('installing', 'Installing...')}
                      </span>
                    ) : (
                      t('installPlugin', 'Install')
                    )}
                  </button>
                  <button
                    onClick={() => { setLocalPreview(null); setLocalFolderPath(null); }}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    {t('cancel', 'Cancel')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Config Form component ────────────────────────────────────────────────────────

function ConfigForm({
  fields,
  values,
  onChange,
  onSave,
  onCancel,
  saveLabel,
  t,
}: {
  fields: PluginConfigField[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, { label: string; value: string }[]>>({});
  const [loadingOptions, setLoadingOptions] = useState<Record<string, boolean>>({});
  const [optionErrors, setOptionErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    // Load dynamic options for fields with source
    const sourcedFields = fields.filter((f) => f.type === 'select' && f.source);
    if (sourcedFields.length === 0) return;

    for (const field of sourcedFields) {
      const src = field.source!;
      setLoadingOptions((prev) => ({ ...prev, [field.key]: true }));
      fetchPluginConfigOptions(src.server, src.tool, src.labelField, src.valueField, src.args)
        .then((options) => {
          setDynamicOptions((prev) => ({ ...prev, [field.key]: options }));
          setOptionErrors((prev) => { const next = { ...prev }; delete next[field.key]; return next; });
        })
        .catch((err) => {
          setOptionErrors((prev) => ({ ...prev, [field.key]: err instanceof Error ? err.message : 'Failed to load options' }));
        })
        .finally(() => {
          setLoadingOptions((prev) => ({ ...prev, [field.key]: false }));
        });
    }
  }, [fields]);

  const getSelectOptions = (field: PluginConfigField): { label: string; value: string }[] => {
    if (field.source) return dynamicOptions[field.key] || [];
    return field.options || [];
  };

  return (
    <div className="border-t border-gray-100 dark:border-gray-700 pt-3 space-y-2">
      {fields.map((field) => (
        <div key={field.key}>
          <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-0.5 uppercase">
            {field.label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {field.description && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">{field.description}</p>
          )}
          {field.type === 'select' ? (
            <>
              {loadingOptions[field.key] ? (
                <div className="flex items-center gap-1.5 py-1.5">
                  <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-[10px] text-gray-400">{t('loadingOptions', 'Loading options...')}</span>
                </div>
              ) : optionErrors[field.key] ? (
                <div className="space-y-1">
                  <p className="text-[10px] text-red-500">{optionErrors[field.key]}</p>
                  <input
                    type="text"
                    value={values[field.key] || ''}
                    onChange={(e) => onChange({ ...values, [field.key]: e.target.value })}
                    placeholder={t('manualEntry', 'Enter value manually...')}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ) : (
                <select
                  value={values[field.key] || field.default || ''}
                  onChange={(e) => onChange({ ...values, [field.key]: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">{t('selectOption', '-- Select --')}</option>
                  {getSelectOptions(field).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
            </>
          ) : (
            <input
              type={field.secret ? 'password' : 'text'}
              value={values[field.key] || ''}
              onChange={(e) => onChange({ ...values, [field.key]: e.target.value })}
              placeholder={field.description || ''}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
            />
          )}
        </div>
      ))}
      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-gray-500"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          onClick={onSave}
          className="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-lg"
        >
          {saveLabel || t('saveConfig', 'Save')}
        </button>
      </div>
    </div>
  );
}
