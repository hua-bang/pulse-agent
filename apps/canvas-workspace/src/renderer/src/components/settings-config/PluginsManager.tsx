import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CanvasPluginEntry,
  CanvasPluginConfigFieldStatus,
  CanvasPluginManifestNode,
  CanvasPluginsImportEntry,
  CanvasPluginsStatus,
} from '../../types';
import { useI18n } from '../../i18n';
import { useAppShell } from '../AppShellProvider';
import {
  activateFederatedRendererPlugins,
  specsFromCanvasPluginsStatus,
} from '../../../../plugins/renderer';
import { CANVAS_PLUGINS_CHANGED_EVENT } from '../../constants/canvasPlugins';
import './settings-config.css';

const countImportEntries = (entries: CanvasPluginsImportEntry[]) => {
  const counts = { added: 0, existing: 0, skipped: 0 };
  for (const entry of entries) counts[entry.status] += 1;
  return counts;
};

const nodeSummary = (node: CanvasPluginManifestNode): string => {
  const parts = [
    node.title,
    node.capabilities?.length ? node.capabilities.join('/') : undefined,
    node.actions?.length ? `actions: ${node.actions.join(', ')}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
};

const PluginHealth = ({ plugin }: { plugin: CanvasPluginEntry }) => {
  const { t } = useI18n();
  if (plugin.error) {
    return (
      <span className="cfg-health cfg-health--err" title={plugin.error}>
        {plugin.error.length > 36 ? `${plugin.error.slice(0, 36)}...` : plugin.error}
      </span>
    );
  }
  return (
    <span className="cfg-health cfg-health--ok">
      {t('pluginConfig.healthOk', { count: plugin.nodes.length })}
    </span>
  );
};

const configStatusLabel = (
  field: CanvasPluginConfigFieldStatus,
  t: ReturnType<typeof useI18n>['t'],
): string => {
  const label = field.source === 'stored'
    ? t('pluginConfig.configStored')
    : field.source === 'env'
      ? t('pluginConfig.configEnv')
      : t('pluginConfig.configMissing');
  return field.valueLength ? `${label} · ${t('pluginConfig.configValueLength', { length: field.valueLength })}` : label;
};

interface PluginConfigEditorProps {
  plugin: CanvasPluginEntry;
  saving: boolean;
  onSave(pluginId: string, key: string, value: string): Promise<void>;
}

const PluginConfigEditor = ({ plugin, saving, onSave }: PluginConfigEditorProps) => {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const fields = plugin.configStatus ?? [];
  if (fields.length === 0) return null;

  const setDraft = (key: string, value: string) => {
    setDrafts((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="cfg-plugin-config">
      <div className="cfg-plugin-config-title">{t('pluginConfig.configTitle')}</div>
      <div className="cfg-plugin-config-list">
        {fields.map((field) => {
          const value = drafts[field.key] ?? '';
          const inputType = field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text';
          return (
            <div key={field.key} className="cfg-plugin-config-row">
              <label className="cfg-field cfg-plugin-config-field">
                <span>
                  {field.label ?? field.key}
                  {field.required && <span className="cfg-required">*</span>}
                </span>
                <input
                  className="cfg-input"
                  type={inputType}
                  value={value}
                  placeholder={
                    field.configured
                      ? t('pluginConfig.configKeepPlaceholder')
                      : field.placeholder ?? t('pluginConfig.configEnterPlaceholder')
                  }
                  onChange={(event) => setDraft(field.key, event.target.value)}
                />
              </label>
              <div className="cfg-plugin-config-meta">
                <span className={`cfg-health cfg-health--${field.source === 'missing' ? 'unknown' : 'ok'}`}>
                  {configStatusLabel(field, t)}
                </span>
                {field.description && (
                  <span className="cfg-plugin-config-description">{field.description}</span>
                )}
                {field.envKeys?.length ? (
                  <span className="cfg-plugin-config-description">
                    {t('pluginConfig.configEnvKeys', { envKeys: field.envKeys.join(', ') })}
                  </span>
                ) : null}
              </div>
              <div className="cfg-plugin-config-actions">
                {field.source === 'stored' && (
                  <button
                    type="button"
                    className="cfg-secondary-btn"
                    onClick={() => void onSave(plugin.id, field.key, '')}
                    disabled={saving}
                  >
                    {t('pluginConfig.configClear')}
                  </button>
                )}
                <button
                  type="button"
                  className="cfg-primary-btn"
                  onClick={() => {
                    void onSave(plugin.id, field.key, value);
                    setDraft(field.key, '');
                  }}
                  disabled={saving || !value.trim()}
                >
                  {t('pluginConfig.configSave')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const PluginsManager = () => {
  const { t } = useI18n();
  const { notify, confirm } = useAppShell();
  const [status, setStatus] = useState<CanvasPluginsStatus | null>(null);
  const [pathText, setPathText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const applyStatus = useCallback(
    async (nextStatus: CanvasPluginsStatus) => {
      setStatus(nextStatus);
      window.dispatchEvent(new CustomEvent(CANVAS_PLUGINS_CHANGED_EVENT, { detail: nextStatus }));
      try {
        await activateFederatedRendererPlugins(specsFromCanvasPluginsStatus(nextStatus));
      } catch (err) {
        notify({
          tone: 'error',
          title: t('pluginConfig.activateFailed'),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [notify, t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.canvasWorkspace.canvasPlugins.list();
      if (res.ok && res.status) {
        await applyStatus(res.status);
      } else {
        notify({ tone: 'error', title: t('pluginConfig.loadFailed'), description: res.error ?? '' });
      }
    } finally {
      setLoading(false);
    }
  }, [applyStatus, notify, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStatusResult = useCallback(
    async (
      res: { ok: boolean; status?: CanvasPluginsStatus; error?: string },
      title: string,
      description?: string,
    ) => {
      if (res.ok && res.status) {
        await applyStatus(res.status);
        notify({ tone: 'success', title, description });
      } else {
        notify({ tone: 'error', title: res.error ?? t('pluginConfig.loadFailed') });
      }
    },
    [applyStatus, notify, t],
  );

  const chooseDirectory = useCallback(async () => {
    setSaving(true);
    try {
      const res = await window.canvasWorkspace.canvasPlugins.chooseDirectory();
      if (res.canceled) return;
      await handleStatusResult(res, t('pluginConfig.directoryAdded'), res.selectedDir);
    } finally {
      setSaving(false);
    }
  }, [handleStatusResult, t]);

  const addPath = useCallback(async () => {
    const dir = pathText.trim();
    if (!dir) {
      notify({ tone: 'error', title: t('pluginConfig.pathRequired') });
      return;
    }
    setSaving(true);
    try {
      const res = await window.canvasWorkspace.canvasPlugins.addDirectory(dir);
      await handleStatusResult(res, t('pluginConfig.directoryAdded'), dir);
      if (res.ok) setPathText('');
    } finally {
      setSaving(false);
    }
  }, [handleStatusResult, notify, pathText, t]);

  const removeDirectory = useCallback(
    async (dir: string) => {
      const accepted = await confirm({
        intent: 'danger',
        title: t('pluginConfig.deleteConfirm', { dir }),
        confirmLabel: t('pluginConfig.remove'),
      });
      if (!accepted) return;
      setSaving(true);
      try {
        const res = await window.canvasWorkspace.canvasPlugins.removeDirectory(dir);
        await handleStatusResult(res, t('pluginConfig.directoryRemoved'), dir);
      } finally {
        setSaving(false);
      }
    },
    [handleStatusResult, confirm, t],
  );

  const importJson = useCallback(
    async (json: string) => {
      setSaving(true);
      try {
        const res = await window.canvasWorkspace.canvasPlugins.importJson(json);
        if (res.ok && res.status) {
          await applyStatus(res.status);
          const entries = res.entries ?? [];
          const counts = countImportEntries(entries);
          notify({
            tone: counts.skipped > 0 && counts.added === 0 ? 'error' : 'success',
            title: t('pluginConfig.importDone', counts),
            description: entries
              .filter((entry) => entry.status === 'skipped')
              .map((entry) => entry.reason ?? entry.dir)
              .join('\n') || undefined,
          });
        } else {
          notify({ tone: 'error', title: t('pluginConfig.importFailed'), description: res.error });
        }
      } finally {
        setSaving(false);
      }
    },
    [applyStatus, notify, t],
  );

  const handleFileChange = useCallback(async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    try {
      await importJson(await file.text());
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [importJson]);

  const savePluginConfig = useCallback(
    async (pluginId: string, key: string, value: string) => {
      setSaving(true);
      try {
        const res = await window.canvasWorkspace.canvasPlugins.setConfig(pluginId, key, value);
        await handleStatusResult(
          res,
          value.trim() ? t('pluginConfig.configSaved') : t('pluginConfig.configCleared'),
          pluginId,
        );
      } finally {
        setSaving(false);
      }
    },
    [handleStatusResult, t],
  );

  const plugins = status?.plugins ?? [];
  const configPath = status?.path ?? '';

  return (
    <div className="cfg-manager">
      <div className="cfg-toolbar">
        <span className="cfg-toolbar-hint">{t('pluginConfig.reloadHint')}</span>
        <button type="button" className="cfg-secondary-btn" onClick={() => void load()} disabled={loading || saving}>
          {t('pluginConfig.refresh')}
        </button>
        <button type="button" className="cfg-secondary-btn" onClick={chooseDirectory} disabled={saving}>
          {t('pluginConfig.chooseDirectory')}
        </button>
        <button
          type="button"
          className="cfg-secondary-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={saving}
        >
          {t('pluginConfig.importJson')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={() => void handleFileChange()}
        />
      </div>

      <div className="cfg-form">
        <label className="cfg-field">
          <span>{t('pluginConfig.manualPath')}</span>
          <input
            className="cfg-input"
            value={pathText}
            placeholder={t('pluginConfig.manualPathPlaceholder')}
            onChange={(event) => setPathText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addPath();
            }}
          />
        </label>
        <div className="cfg-form-actions">
          <button type="button" className="cfg-primary-btn" onClick={addPath} disabled={saving}>
            {t('pluginConfig.addPath')}
          </button>
        </div>
      </div>

      {loading && plugins.length === 0 ? (
        <div className="cfg-empty">{t('pluginConfig.loading')}</div>
      ) : plugins.length === 0 ? (
        <div className="cfg-empty">{t('pluginConfig.empty')}</div>
      ) : (
        <ul className="cfg-list">
          {plugins.map((plugin) => (
            <li key={plugin.dir} className="cfg-list-entry">
              <div className="cfg-list-item">
                <div className="cfg-list-main">
                  <div className="cfg-list-title">
                    {plugin.id}
                    {plugin.version && <span className="cfg-tag">{plugin.version}</span>}
                    <PluginHealth plugin={plugin} />
                  </div>
                  <div className="cfg-list-desc" title={plugin.dir}>
                    {plugin.dir}
                  </div>
                </div>
                <div className="cfg-list-actions">
                  <button
                    type="button"
                    className="cfg-danger-btn"
                    onClick={() => void removeDirectory(plugin.dir)}
                    disabled={saving}
                  >
                    {t('pluginConfig.remove')}
                  </button>
                </div>
              </div>

              <div className="cfg-tools">
                {plugin.nodes.length === 0 ? (
                  <div className="cfg-tools-empty">{t('pluginConfig.noNodes')}</div>
                ) : (
                  <ul className="cfg-tools-list">
                    {plugin.nodes.map((node) => (
                      <li key={node.type} className="cfg-tool">
                        <span className="cfg-tool-name">{node.type}</span>
                        <span className="cfg-tool-desc" title={nodeSummary(node)}>
                          {nodeSummary(node)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {plugin.rendererSpecs.length > 0 && (
                  <ul className="cfg-tools-list">
                    {plugin.rendererSpecs.map((spec) => (
                      <li key={`${spec.name}:${spec.entry}`} className="cfg-tool">
                        <span className="cfg-tool-name">{spec.name}</span>
                        <span className="cfg-tool-desc" title={spec.entry}>
                          {t('pluginConfig.rendererRemote')}: {spec.entry}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {plugin.main && (
                  <ul className="cfg-tools-list">
                    <li className="cfg-tool">
                      <span className="cfg-tool-name">{t('pluginConfig.mainEntry')}</span>
                      <span className="cfg-tool-desc" title={plugin.main.entry}>
                        {plugin.main.entry}
                        {plugin.main.format ? ` · ${plugin.main.format}` : ''}
                        {plugin.main.runtime ? ` · ${plugin.main.runtime}` : ''}
                      </span>
                    </li>
                  </ul>
                )}
                {(plugin.skills?.length ?? 0) > 0 && (
                  <ul className="cfg-tools-list">
                    {plugin.skills?.map((skill) => (
                      <li key={skill.path} className="cfg-tool">
                        <span className="cfg-tool-name">
                          {skill.name ?? t('pluginConfig.skillEntry')}
                        </span>
                        <span className="cfg-tool-desc" title={skill.path}>
                          {skill.description
                            ? `${skill.description} · ${skill.path}`
                            : skill.path}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <PluginConfigEditor plugin={plugin} saving={saving} onSave={savePluginConfig} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {configPath && (
        <div className="cfg-dir-hint" title={configPath}>
          {t('pluginConfig.dirHint', { path: configPath })}
        </div>
      )}
    </div>
  );
};
