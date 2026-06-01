/**
 * McpManager — CRUD UI for MCP servers at a given scope.
 * Reused by the global Settings panel and the per-workspace settings drawer.
 *
 * Health badges per row come from the engine MCP plugin's status snapshot
 * (captured during its last initialize). After a save, the IPC awaits the
 * engine reload before returning, so the statuses we display are accurate.
 *
 * When `showInherited` is true and `scope` is a workspace, also surfaces the
 * agent-loaded global servers as a read-only section — matching what we do
 * for skills, so the user can see (and override) what the agent really has.
 */

import { useCallback, useEffect, useState } from 'react';
import type {
  CanvasConfigScope,
  CanvasMcpServer,
  CanvasMcpServerHealth,
  CanvasMcpStatus,
  CanvasMcpTransport,
} from '../../types';
import { useI18n } from '../../i18n';
import { useAppShell } from '../AppShellProvider';
import './settings-config.css';

interface Props {
  scope: CanvasConfigScope;
  showInherited?: boolean;
}

interface Draft {
  originalName?: string;
  name: string;
  transport: CanvasMcpTransport;
  url: string;
  headersText: string;
  command: string;
  argsText: string;
  envText: string;
  cwd: string;
  deferTools: boolean;
}

const EMPTY_DRAFT: Draft = {
  name: '',
  transport: 'http',
  url: '',
  headersText: '',
  command: '',
  argsText: '',
  envText: '',
  cwd: '',
  deferTools: false,
};

function parseKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function stringifyKeyValues(map?: Record<string, string>): string {
  if (!map) return '';
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function serverToDraft(server: CanvasMcpServer): Draft {
  return {
    originalName: server.name,
    name: server.name,
    transport: server.transport,
    url: server.url ?? '',
    headersText: stringifyKeyValues(server.headers),
    command: server.command ?? '',
    argsText: (server.args ?? []).join('\n'),
    envText: stringifyKeyValues(server.env),
    cwd: server.cwd ?? '',
    deferTools: server.deferTools ?? false,
  };
}

function draftToServer(draft: Draft): CanvasMcpServer {
  const server: CanvasMcpServer = {
    name: draft.name.trim(),
    transport: draft.transport,
    deferTools: draft.deferTools,
  };
  if (draft.transport === 'stdio') {
    server.command = draft.command.trim();
    const args = draft.argsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (args.length) server.args = args;
    const env = parseKeyValues(draft.envText);
    if (Object.keys(env).length) server.env = env;
    if (draft.cwd.trim()) server.cwd = draft.cwd.trim();
  } else {
    server.url = draft.url.trim();
    const headers = parseKeyValues(draft.headersText);
    if (Object.keys(headers).length) server.headers = headers;
  }
  return server;
}

interface HealthBadgeProps {
  health: CanvasMcpServerHealth | undefined;
  t: (key: any, params?: any) => string;
}

const HealthBadge = ({ health, t }: HealthBadgeProps) => {
  if (!health) {
    return <span className="cfg-health cfg-health--unknown">{t('mcpConfig.healthUnknown')}</span>;
  }
  if (health.ok) {
    return (
      <span className="cfg-health cfg-health--ok">
        ✓ {t('mcpConfig.healthOk', { count: health.toolCount })}
      </span>
    );
  }
  return (
    <span className="cfg-health cfg-health--err" title={health.error}>
      ⚠ {health.error.length > 40 ? `${health.error.slice(0, 40)}…` : health.error}
    </span>
  );
};

export const McpManager = ({ scope, showInherited = false }: Props) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const [servers, setServers] = useState<CanvasMcpServer[]>([]);
  const [statuses, setStatuses] = useState<Record<string, CanvasMcpServerHealth>>({});
  const [inherited, setInherited] = useState<CanvasMcpServer[]>([]);
  const [inheritedStatuses, setInheritedStatuses] = useState<Record<string, CanvasMcpServerHealth>>({});
  const [path, setPath] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const scopeKey = scope.level === 'workspace' ? scope.workspaceId : 'global';
  const inheritedEnabled = showInherited && scope.level === 'workspace';

  const applyStatus = useCallback((status: CanvasMcpStatus) => {
    setServers(status.servers);
    setPath(status.path);
    setStatuses(status.statuses ?? {});
  }, []);

  const load = useCallback(async () => {
    const res = await window.canvasWorkspace.canvasMcp.list(scope);
    if (res.ok && res.status) {
      applyStatus(res.status);
    } else {
      notify({ tone: 'error', title: t('mcpConfig.loadFailed'), description: res.error ?? '' });
    }
    if (inheritedEnabled) {
      const g = await window.canvasWorkspace.canvasMcp.list({ level: 'global' });
      if (g.ok && g.status) {
        setInherited(g.status.servers);
        setInheritedStatuses(g.status.statuses ?? {});
      }
    } else {
      setInherited([]);
      setInheritedStatuses({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, inheritedEnabled, applyStatus, t]);

  useEffect(() => {
    setDraft(null);
    setJsonText(null);
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      notify({ tone: 'error', title: t('mcpConfig.nameRequired') });
      return;
    }
    setSaving(true);
    try {
      const res = await window.canvasWorkspace.canvasMcp.upsert(scope, draftToServer(draft), draft.originalName);
      if (res.ok && res.status) {
        applyStatus(res.status);
        setDraft(null);
        // Toast the connection outcome so the user knows it actually worked.
        const health = res.status.statuses?.[draftToServer(draft).name];
        if (health?.ok) {
          notify({
            tone: 'success',
            title: t('mcpConfig.savedOk', { name: draft.name, count: health.toolCount }),
          });
        } else if (health && !health.ok) {
          notify({ tone: 'error', title: t('mcpConfig.savedErr', { name: draft.name }), description: health.error });
        }
      } else {
        notify({ tone: 'error', title: res.error ?? t('mcpConfig.loadFailed') });
      }
    } finally {
      setSaving(false);
    }
  }, [draft, scope, notify, t, applyStatus]);

  const remove = useCallback(
    async (name: string) => {
      if (!window.confirm(t('mcpConfig.deleteConfirm', { name }))) return;
      const res = await window.canvasWorkspace.canvasMcp.remove(scope, name);
      if (res.ok && res.status) applyStatus(res.status);
      else notify({ tone: 'error', title: res.error ?? t('mcpConfig.loadFailed') });
    },
    [scope, notify, t, applyStatus],
  );

  const importJson = useCallback(async () => {
    if (jsonText === null) return;
    setImporting(true);
    try {
      const res = await window.canvasWorkspace.canvasMcp.importJson(scope, jsonText);
      if (res.ok && res.status) {
        applyStatus(res.status);
        const entries = res.entries ?? [];
        const counts = { added: 0, replaced: 0, skipped: 0 };
        for (const e of entries) counts[e.status] += 1;
        // Combine the import counts with any post-reload connection failures
        // so a "0 added, 0 replaced, 0 skipped + every server failed" import
        // doesn't read as a success.
        const failedNames = entries
          .filter((e) => e.status !== 'skipped')
          .map((e) => e.name)
          .filter((name) => res.status?.statuses?.[name]?.ok === false);
        const failedDescription = failedNames
          .map((name) => `${name}: ${res.status?.statuses?.[name] && !res.status.statuses[name].ok ? res.status.statuses[name].error : ''}`)
          .join('\n');
        const skippedDescription = entries
          .filter((e) => e.status === 'skipped')
          .map((e) => `${e.name}: ${e.reason ?? ''}`)
          .join('\n');
        notify({
          tone:
            (counts.skipped > 0 && counts.added + counts.replaced === 0) || failedNames.length > 0
              ? 'error'
              : 'success',
          title: t('mcpConfig.importDone', counts),
          description: [skippedDescription, failedDescription].filter(Boolean).join('\n') || undefined,
        });
        setJsonText(null);
      } else {
        notify({ tone: 'error', title: t('mcpConfig.importFailed'), description: res.error });
      }
    } finally {
      setImporting(false);
    }
  }, [jsonText, scope, notify, t, applyStatus]);

  const isStdio = draft?.transport === 'stdio';

  return (
    <div className="cfg-manager">
      <div className="cfg-toolbar">
        {servers.length > 0 && (
          <span className="cfg-toolbar-hint">{t('mcpConfig.reloadHint')}</span>
        )}
        <button
          type="button"
          className="cfg-secondary-btn"
          onClick={() => setJsonText(jsonText === null ? '' : null)}
          disabled={draft !== null}
        >
          {t('mcpConfig.importJson')}
        </button>
        <button
          type="button"
          className="cfg-secondary-btn"
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
          disabled={draft !== null || jsonText !== null}
        >
          + {t('mcpConfig.add')}
        </button>
      </div>

      {jsonText !== null && (
        <div className="cfg-form">
          <label className="cfg-field">
            <span>{t('mcpConfig.importJson')}</span>
            <textarea
              className="cfg-textarea"
              rows={10}
              value={jsonText}
              placeholder={t('mcpConfig.importJsonPlaceholder')}
              spellCheck={false}
              autoFocus
              onChange={(e) => setJsonText(e.target.value)}
            />
            <div className="cfg-toolbar-hint" style={{ flex: 'none', marginTop: 4 }}>
              {t('mcpConfig.importJsonHint')}
            </div>
          </label>
          <div className="cfg-form-actions">
            <button
              type="button"
              className="cfg-secondary-btn"
              onClick={() => setJsonText(null)}
              disabled={importing}
            >
              {t('mcpConfig.cancel')}
            </button>
            <button
              type="button"
              className="cfg-primary-btn"
              onClick={() => void importJson()}
              disabled={importing || !jsonText.trim()}
            >
              {importing ? t('mcpConfig.importing') : t('mcpConfig.parseAndImport')}
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div className="cfg-form">
          <label className="cfg-field">
            <span>{t('mcpConfig.name')}</span>
            <input
              className="cfg-input"
              value={draft.name}
              placeholder={t('mcpConfig.namePlaceholder')}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="cfg-field">
            <span>{t('mcpConfig.transport')}</span>
            <select
              className="cfg-input"
              value={draft.transport}
              onChange={(e) => setDraft({ ...draft, transport: e.target.value as CanvasMcpTransport })}
            >
              <option value="http">http</option>
              <option value="sse">sse</option>
              <option value="stdio">stdio</option>
            </select>
          </label>

          {isStdio ? (
            <>
              <label className="cfg-field">
                <span>{t('mcpConfig.command')}</span>
                <input
                  className="cfg-input"
                  value={draft.command}
                  placeholder={t('mcpConfig.commandPlaceholder')}
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                />
              </label>
              <label className="cfg-field">
                <span>{t('mcpConfig.args')}</span>
                <textarea
                  className="cfg-textarea"
                  rows={3}
                  value={draft.argsText}
                  spellCheck={false}
                  onChange={(e) => setDraft({ ...draft, argsText: e.target.value })}
                />
              </label>
              <label className="cfg-field">
                <span>{t('mcpConfig.env')}</span>
                <textarea
                  className="cfg-textarea"
                  rows={3}
                  value={draft.envText}
                  spellCheck={false}
                  onChange={(e) => setDraft({ ...draft, envText: e.target.value })}
                />
              </label>
              <label className="cfg-field">
                <span>{t('mcpConfig.cwd')}</span>
                <input
                  className="cfg-input"
                  value={draft.cwd}
                  onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
                />
              </label>
            </>
          ) : (
            <>
              <label className="cfg-field">
                <span>{t('mcpConfig.url')}</span>
                <input
                  className="cfg-input"
                  value={draft.url}
                  placeholder={t('mcpConfig.urlPlaceholder')}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </label>
              <label className="cfg-field">
                <span>{t('mcpConfig.headers')}</span>
                <textarea
                  className="cfg-textarea"
                  rows={3}
                  value={draft.headersText}
                  spellCheck={false}
                  onChange={(e) => setDraft({ ...draft, headersText: e.target.value })}
                />
              </label>
            </>
          )}

          <label className="cfg-checkbox">
            <input
              type="checkbox"
              checked={draft.deferTools}
              onChange={(e) => setDraft({ ...draft, deferTools: e.target.checked })}
            />
            <span>{t('mcpConfig.deferTools')}</span>
          </label>

          <div className="cfg-form-actions">
            <button type="button" className="cfg-secondary-btn" onClick={() => setDraft(null)} disabled={saving}>
              {t('mcpConfig.cancel')}
            </button>
            <button type="button" className="cfg-primary-btn" onClick={() => void save()} disabled={saving}>
              {saving ? t('mcpConfig.saving') : t('mcpConfig.save')}
            </button>
          </div>
        </div>
      )}

      {servers.length === 0 && !draft ? (
        <div className="cfg-empty">{t('mcpConfig.empty')}</div>
      ) : (
        <ul className="cfg-list">
          {servers.map((server) => (
            <li key={server.name} className="cfg-list-item">
              <div className="cfg-list-main">
                <div className="cfg-list-title">
                  {server.name} <span className="cfg-tag">{server.transport}</span>
                  <HealthBadge health={statuses[server.name]} t={t} />
                </div>
                <div className="cfg-list-desc">{server.transport === 'stdio' ? server.command : server.url}</div>
              </div>
              <div className="cfg-list-actions">
                <button type="button" className="cfg-secondary-btn" onClick={() => setDraft(serverToDraft(server))}>
                  {t('mcpConfig.edit')}
                </button>
                <button type="button" className="cfg-danger-btn" onClick={() => void remove(server.name)}>
                  {t('mcpConfig.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {inheritedEnabled && inherited.length > 0 && (
        <div className="cfg-inherited">
          <div className="cfg-inherited-header">
            <span className="cfg-inherited-title">
              {t('mcpConfig.inheritedTitle', { count: inherited.length })}
            </span>
            <span className="cfg-inherited-manage">{t('mcpConfig.inheritedManage')}</span>
          </div>
          <ul className="cfg-list cfg-list--scrollable">
            {inherited.map((server) => {
              const overridden = servers.some((s) => s.name === server.name);
              return (
                <li
                  key={server.name}
                  className={`cfg-list-item cfg-list-item--readonly${overridden ? ' cfg-list-item--shadowed' : ''}`}
                >
                  <div className="cfg-list-main">
                    <div className="cfg-list-title">
                      {server.name} <span className="cfg-tag">{server.transport}</span>
                      <span className="cfg-tag">global</span>
                      <HealthBadge health={inheritedStatuses[server.name]} t={t} />
                    </div>
                    <div className="cfg-list-desc">
                      {server.transport === 'stdio' ? server.command : server.url}
                    </div>
                  </div>
                  {overridden && (
                    <span className="cfg-shadow-warn" title={t('mcpConfig.inheritedOverridden')}>
                      ⚠ {t('mcpConfig.inheritedOverridden')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {path && (
        <div className="cfg-dir-hint" title={path}>
          {path}
        </div>
      )}
    </div>
  );
};
