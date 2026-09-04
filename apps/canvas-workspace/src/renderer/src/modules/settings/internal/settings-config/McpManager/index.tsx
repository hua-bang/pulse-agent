/** MCP server CRUD for global settings and per-workspace settings drawers. */

import { useCallback, useEffect, useState } from 'react';
import type {
  CanvasConfigScope,
  CanvasMcpOAuthStatus,
  CanvasMcpServer,
  CanvasMcpServerHealth,
  CanvasMcpStatus,
} from '../../../../../types';
import { useI18n } from '../../../../../i18n';
import { useAppShell } from '../../../../../shared/appShell';
import { Button, TextField } from '../../../../../components/ui';
import {
  createEmptyMcpDraft,
  mcpDraftForServer,
  mcpServerFromDraft,
  type McpServerDraft,
} from './model';
import { ServerForm } from './ServerForm';
import { InheritedServerList } from './InheritedServerList';
import { ServerList } from './ServerList';
import '../settings-config.css';
import './index.css';

interface Props {
  scope: CanvasConfigScope;
  showInherited?: boolean;
}

export const McpManager = ({ scope, showInherited = false }: Props) => {
  const { t } = useI18n();
  const { notify, confirm } = useAppShell();
  const [servers, setServers] = useState<CanvasMcpServer[]>([]);
  const [statuses, setStatuses] = useState<Record<string, CanvasMcpServerHealth>>({});
  const [oauthStatuses, setOauthStatuses] = useState<Record<string, CanvasMcpOAuthStatus>>({});
  const [inherited, setInherited] = useState<CanvasMcpServer[]>([]);
  const [inheritedStatuses, setInheritedStatuses] = useState<Record<string, CanvasMcpServerHealth>>({});
  const [inheritedOauthStatuses, setInheritedOauthStatuses] = useState<Record<string, CanvasMcpOAuthStatus>>({});
  const [path, setPath] = useState('');
  const [draft, setDraft] = useState<McpServerDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Server names whose tool list is expanded, and the `${server}::${tool}` key
  // currently mid-toggle (so we can disable just that one checkbox).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [busyOAuth, setBusyOAuth] = useState<string | null>(null);
  const [busyReload, setBusyReload] = useState<'all' | string | null>(null);
  const scopeKey = scope.level === 'workspace' ? scope.workspaceId : 'global';
  const inheritedEnabled = showInherited && scope.level === 'workspace';

  const applyStatus = useCallback((status: CanvasMcpStatus) => {
    setServers(status.servers);
    setPath(status.path);
    setStatuses(status.statuses ?? {});
    setOauthStatuses(status.oauthStatuses ?? {});
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
        setInheritedOauthStatuses(g.status.oauthStatuses ?? {});
      }
    } else {
      setInherited([]);
      setInheritedStatuses({});
      setInheritedOauthStatuses({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, inheritedEnabled, applyStatus, t]);

  useEffect(() => {
    setDraft(null);
    setJsonText(null);
    void load();
  }, [load]);

  const reloadTools = useCallback(
    async (serverName?: string) => {
      const busyKey = serverName ?? 'all';
      setBusyReload(busyKey);
      try {
        const res = await window.canvasWorkspace.canvasMcp.reload(scope);
        if (res.ok && res.status) {
          applyStatus(res.status);
          const health = serverName ? res.status.statuses?.[serverName] : undefined;
          if (serverName && health?.ok) {
            notify({ tone: 'success', title: t('mcpConfig.connectOk', { name: serverName, count: health.toolCount }) });
          } else if (serverName && health && !health.ok) {
            notify({ tone: 'error', title: t('mcpConfig.connectFailed', { name: serverName }), description: health.error });
          } else if (!serverName) {
            notify({ tone: 'success', title: t('mcpConfig.reloadOk') });
          }
        } else {
          notify({ tone: 'error', title: res.error ?? t('mcpConfig.loadFailed') });
        }
      } finally {
        setBusyReload(null);
      }
    },
    [scope, applyStatus, notify, t],
  );

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      notify({ tone: 'error', title: t('mcpConfig.nameRequired') });
      return;
    }
    setSaving(true);
    try {
      const res = await window.canvasWorkspace.canvasMcp.upsert(scope, mcpServerFromDraft(draft), draft.originalName);
      if (res.ok && res.status) {
        applyStatus(res.status);
        setDraft(null);
        // Toast the connection outcome so the user knows it actually worked.
        const server = mcpServerFromDraft(draft);
        const health = res.status.statuses?.[server.name];
        if (health?.ok) {
          notify({
            tone: 'success',
            title: t('mcpConfig.savedOk', { name: draft.name, count: health.toolCount }),
          });
        } else if (server.auth === 'oauth' && !health?.ok) {
          notify({ tone: 'success', title: t('mcpConfig.oauthSavedPending', { name: draft.name }) });
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
      const accepted = await confirm({
        intent: 'danger',
        title: t('mcpConfig.deleteConfirm', { name }),
        confirmLabel: t('mcpConfig.delete'),
      });
      if (!accepted) return;
      const res = await window.canvasWorkspace.canvasMcp.remove(scope, name);
      if (res.ok && res.status) applyStatus(res.status);
      else notify({ tone: 'error', title: res.error ?? t('mcpConfig.loadFailed') });
    },
    [scope, notify, confirm, t, applyStatus],
  );

  const toggleTool = useCallback(
    async (serverName: string, toolName: string, enabled: boolean) => {
      const key = `${serverName}::${toolName}`;
      setBusyTool(key);
      try {
        const res = await window.canvasWorkspace.canvasMcp.setToolEnabled(scope, serverName, toolName, enabled);
        if (res.ok && res.status) applyStatus(res.status);
        else notify({ tone: 'error', title: res.error ?? t('mcpConfig.toolUpdateFailed') });
      } finally {
        setBusyTool(null);
      }
    },
    [scope, applyStatus, notify, t],
  );

  const connectOAuth = useCallback(
    async (name: string) => {
      setBusyOAuth(name);
      try {
        const res = await window.canvasWorkspace.canvasMcp.oauthConnect(scope, name);
        if (res.ok && res.status) {
          applyStatus(res.status);
          const health = res.status.statuses?.[name];
          if (health?.ok) {
            notify({ tone: 'success', title: t('mcpConfig.oauthConnectOkWithTools', { name, count: health.toolCount }) });
          } else if (health && !health.ok) {
            notify({ tone: 'error', title: t('mcpConfig.oauthConnectToolsFailed', { name }), description: health.error });
          } else {
            notify({ tone: 'success', title: t('mcpConfig.oauthConnectOk', { name }) });
          }
        } else {
          notify({ tone: 'error', title: res.error ?? t('mcpConfig.oauthConnectFailed') });
        }
      } finally {
        setBusyOAuth(null);
      }
    },
    [scope, applyStatus, notify, t],
  );

  const disconnectOAuth = useCallback(
    async (name: string) => {
      setBusyOAuth(name);
      try {
        const res = await window.canvasWorkspace.canvasMcp.oauthDisconnect(scope, name);
        if (res.ok && res.status) {
          applyStatus(res.status);
          notify({ tone: 'success', title: t('mcpConfig.oauthDisconnectOk', { name }) });
        } else {
          notify({ tone: 'error', title: res.error ?? t('mcpConfig.oauthDisconnectFailed') });
        }
      } finally {
        setBusyOAuth(null);
      }
    },
    [scope, applyStatus, notify, t],
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

  return (
    <div className="cfg-manager">
      <div className="cfg-toolbar">
        {servers.length > 0 && (
          <span className="cfg-toolbar-hint">{t('mcpConfig.reloadHint')}</span>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void reloadTools()}
          disabled={draft !== null || jsonText !== null || busyReload !== null || servers.length === 0}
        >
          {busyReload === 'all' ? t('mcpConfig.reloadingTools') : t('mcpConfig.reloadTools')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setJsonText(jsonText === null ? '' : null)}
          disabled={draft !== null}
        >
          {t('mcpConfig.importJson')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDraft(createEmptyMcpDraft())}
          disabled={draft !== null || jsonText !== null}
        >
          + {t('mcpConfig.add')}
        </Button>
      </div>

      {jsonText !== null && (
        <div className="cfg-form">
          <TextField
            label={t('mcpConfig.importJson')}
            multiline
            rows={10}
            className="cfg-textarea-mono"
            value={jsonText}
            placeholder={t('mcpConfig.importJsonPlaceholder')}
            spellCheck={false}
            autoFocus
            onChange={(e) => setJsonText(e.target.value)}
            hint={t('mcpConfig.importJsonHint')}
          />
          <div className="cfg-form-actions">
            <Button variant="secondary" size="sm" onClick={() => setJsonText(null)} disabled={importing}>
              {t('mcpConfig.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void importJson()}
              disabled={importing || !jsonText.trim()}
            >
              {importing ? t('mcpConfig.importing') : t('mcpConfig.parseAndImport')}
            </Button>
          </div>
        </div>
      )}

      {draft && (
        <ServerForm
          draft={draft}
          saving={saving}
          t={t}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => void save()}
        />
      )}

      {servers.length === 0 && !draft ? (
        <div className="cfg-empty">{t('mcpConfig.empty')}</div>
      ) : (
        <ServerList
          view={{ servers, statuses, oauthStatuses, expanded, busyTool, busyOAuth, busyReload }}
          actions={{
            toggleExpanded: (key) => setExpanded((current) => ({ ...current, [key]: !current[key] })),
            reload: (name) => void reloadTools(name),
            connectOAuth: (name) => void connectOAuth(name),
            disconnectOAuth: (name) => void disconnectOAuth(name),
            edit: (server) => setDraft(mcpDraftForServer(server)),
            remove: (name) => void remove(name),
            toggleTool: (server, tool, enabled) => void toggleTool(server, tool, enabled),
          }}
          t={t}
        />
      )}

      {inheritedEnabled && inherited.length > 0 && (
        <InheritedServerList
          servers={inherited}
          localServerNames={new Set(servers.map((server) => server.name))}
          statuses={inheritedStatuses}
          oauthStatuses={inheritedOauthStatuses}
          expanded={expanded}
          onToggleExpanded={(key) => setExpanded((current) => ({ ...current, [key]: !current[key] }))}
          t={t}
        />
      )}

      {path && (
        <div className="cfg-dir-hint" title={path}>
          {path}
        </div>
      )}
    </div>
  );
};
