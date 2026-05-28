/**
 * McpManager — CRUD UI for MCP servers at a given scope.
 * Reused by the global Settings panel and the per-workspace settings drawer.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CanvasConfigScope, CanvasMcpServer, CanvasMcpTransport } from '../../types';
import { useI18n } from '../../i18n';
import { useAppShell } from '../AppShellProvider';
import './settings-config.css';

interface Props {
  scope: CanvasConfigScope;
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

export const McpManager = ({ scope }: Props) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const [servers, setServers] = useState<CanvasMcpServer[]>([]);
  const [path, setPath] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const scopeKey = scope.level === 'workspace' ? scope.workspaceId : 'global';

  const load = useCallback(async () => {
    const res = await window.canvasWorkspace.canvasMcp.list(scope);
    if (res.ok && res.status) {
      setServers(res.status.servers);
      setPath(res.status.path);
    } else {
      notify({ tone: 'error', title: t('mcpConfig.loadFailed'), description: res.error ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, t]);

  useEffect(() => {
    setDraft(null);
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
        setServers(res.status.servers);
        setDraft(null);
      } else {
        notify({ tone: 'error', title: res.error ?? t('mcpConfig.loadFailed') });
      }
    } finally {
      setSaving(false);
    }
  }, [draft, scope, notify, t]);

  const remove = useCallback(
    async (name: string) => {
      if (!window.confirm(t('mcpConfig.deleteConfirm', { name }))) return;
      const res = await window.canvasWorkspace.canvasMcp.remove(scope, name);
      if (res.ok && res.status) setServers(res.status.servers);
      else notify({ tone: 'error', title: res.error ?? t('mcpConfig.loadFailed') });
    },
    [scope, notify, t],
  );

  const isStdio = draft?.transport === 'stdio';

  return (
    <div className="cfg-manager">
      <div className="cfg-toolbar">
        <button
          type="button"
          className="cfg-primary-btn"
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
          disabled={draft !== null}
        >
          {t('mcpConfig.add')}
        </button>
        <span className="cfg-toolbar-hint">{t('mcpConfig.reloadHint')}</span>
      </div>

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

      {path && <div className="cfg-dir-hint">{t('mcpConfig.dirHint', { path })}</div>}
    </div>
  );
};
