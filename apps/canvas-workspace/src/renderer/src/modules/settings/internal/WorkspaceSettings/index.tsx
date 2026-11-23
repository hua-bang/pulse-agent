/**
 * Workspace settings drawer — per-workspace meta + environment + intent.
 *
 * Three sections, mirroring the long-term workspace model:
 *  1. Identity   — name (editable)
 *  2. Environment — rootFolder (the directory where work lands)
 *  3. Intent & State — pulse-workspace.md content (shared brain for
 *     human + Canvas Agent)
 *
 * pulse-workspace.md lives at <rootFolder>/pulse-workspace.md so it's
 * git-friendly and shareable, while the Pulse-specific filename keeps
 * other coding agents from auto-loading it as their own instructions.
 * Its content is injected into the Canvas Agent's system prompt on every
 * chat turn (see canvas-agent/canvas-agent.ts).
 */

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import type { RemoteVpsWorkspaceConfigDto } from '../../../../../../shared/api/remote-vps';
import type { WorkspaceEntry } from '../../../../shared/workspaces';
import { Drawer, Button, TextField, FieldRow, SegmentedControl } from '../../../../components/ui';
import { McpManager } from '../settings-config/McpManager';
import { useAppShell } from '../../../../shared/appShell';
import { useI18n } from '../../../../i18n';
import { remoteVpsCopy } from '../../components/RemoteFolderPickerModal/copy';
import { isImeComposing } from '../../../../utils/ime';
import './index.css';

const RemoteVpsCard = lazy(() =>
  import('./RemoteVpsCard').then((mod) => ({ default: mod.RemoteVpsCard })),
);
const RemoteFolderPickerModal = lazy(() =>
  import('../../components/RemoteFolderPickerModal').then((mod) => ({
    default: mod.RemoteFolderPickerModal,
  })),
);

interface Props {
  workspace: WorkspaceEntry | null;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onSetRootFolder: (id: string, folderPath: string) => void;
}

const WORKSPACE_DOC_FILENAME = 'pulse-workspace.md';

const buildWorkspaceDocTemplate = (
  workspaceName: string,
  labels: { goal: string; status: string; notes: string },
): string =>
  `# ${workspaceName}\n\n## Goal\n<${labels.goal}>\n\n## Status\n<${labels.status}>\n\n## Notes\n<${labels.notes}>\n`;

const joinPath = (folder: string, file: string): string => {
  const trimmed = folder.endsWith('/') ? folder.slice(0, -1) : folder;
  return `${trimmed}/${file}`;
};

export const WorkspaceSettingsDrawer = ({
  workspace,
  onClose,
  onRename,
  onSetRootFolder,
}: Props) => {
  const { t, language } = useI18n();
  const vpsCopy = remoteVpsCopy(language);
  const { confirm } = useAppShell();
  const open = workspace !== null;

  const [nameDraft, setNameDraft] = useState('');
  const [agentsDoc, setAgentsDoc] = useState('');
  const [agentsDocLoaded, setAgentsDocLoaded] = useState(false);
  const [agentsDocExists, setAgentsDocExists] = useState(false);
  const [remoteVps, setRemoteVps] = useState<RemoteVpsWorkspaceConfigDto | null>(null);
  const [remoteVpsReady, setRemoteVpsReady] = useState(false);
  const [envMode, setEnvMode] = useState<'local' | 'vps'>('local');
  const [remoteDocPath, setRemoteDocPath] = useState<string | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);
  const [error, setError] = useState<string>();
  const [savedHint, setSavedHint] = useState(false);
  const [intent, setIntent] = useState('');
  const [generating, setGenerating] = useState(false);
  const [remoteFolderPickerOpen, setRemoteFolderPickerOpen] = useState(false);

  const handleRemoteVpsChange = useCallback((cfg: RemoteVpsWorkspaceConfigDto | null) => {
    setRemoteVps(cfg);
    setRemoteVpsReady(true);
    setEnvMode(cfg ? 'vps' : 'local');
  }, []);

  const handleDisconnectToLocal = useCallback(async () => {
    if (!workspace) return;
    const res = await window.canvasWorkspace?.remoteVps.removeConfig(workspace.id);
    if (!res?.ok) {
      setError(res?.error ?? vpsCopy.unbindFailed);
      return;
    }
    setRemoteVps(null);
    setEnvMode('local');
  }, [workspace, vpsCopy]);

  const handleRemoteFolderSelect = useCallback(async (folderPath: string) => {
    if (!workspace || !remoteVps) return;
    const nextConfig: RemoteVpsWorkspaceConfigDto = { ...remoteVps, cwd: folderPath };
    const res = await window.canvasWorkspace?.remoteVps.saveConfig(workspace.id, nextConfig);
    if (!res?.ok) {
      setError(res?.error ?? 'Failed to update remote folder.');
      return;
    }
    setRemoteVps(nextConfig);
  }, [remoteVps, workspace]);

  // Reset draft fields and load remote VPS binding when opening or switching workspace.
  useEffect(() => {
    if (!open || !workspace) {
      setRemoteVps(null);
      setRemoteVpsReady(false);
      setEnvMode('local');
      setRemoteDocPath(null);
      return;
    }
    setNameDraft(workspace.name);
    setError(undefined);
    setSavedHint(false);
    setIntent('');
    setGenerating(false);

    const api = window.canvasWorkspace?.remoteVps;
    if (!api) {
      setRemoteVps(null);
      setEnvMode('local');
      setRemoteVpsReady(true);
      return;
    }
    let cancelled = false;
    setRemoteVpsReady(false);
    void api.getConfig(workspace.id).then((res) => {
      if (cancelled) return;
      const cfg = res.ok ? res.config : null;
      setRemoteVps(cfg);
      setEnvMode(cfg ? 'vps' : 'local');
      setRemoteVpsReady(true);
    }).catch(() => {
      if (cancelled) return;
      setRemoteVps(null);
      setEnvMode('local');
      setRemoteVpsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, workspace]);

  // Load pulse-workspace.md from either VPS (when bound) or local rootFolder.
  useEffect(() => {
    if (!open || !workspace || !remoteVpsReady) return;
    let cancelled = false;
    setAgentsDocLoaded(false);
    const fallbackTemplate = buildWorkspaceDocTemplate(workspace.name, {
      goal: t('workspaceSettings.goalPlaceholder'),
      status: t('workspaceSettings.statusPlaceholder'),
      notes: t('workspaceSettings.notesPlaceholder'),
    });

    if (remoteVps) {
      void window.canvasWorkspace?.remoteVps
        .readWorkspaceDoc(workspace.id, remoteVps.cwd)
        .then((res) => {
          if (cancelled) return;
          setRemoteDocPath(res?.path ?? null);
          if (res?.ok && res.exists && typeof res.content === 'string') {
            setAgentsDoc(res.content);
            setAgentsDocExists(true);
          } else {
            setAgentsDoc(fallbackTemplate);
            setAgentsDocExists(false);
          }
          setAgentsDocLoaded(true);
        });
      return () => {
        cancelled = true;
      };
    }

    setRemoteDocPath(null);
    if (!workspace.rootFolder) {
      setAgentsDoc('');
      setAgentsDocExists(false);
      setAgentsDocLoaded(true);
      return;
    }

    const filePath = joinPath(workspace.rootFolder, WORKSPACE_DOC_FILENAME);
    void window.canvasWorkspace?.file.read(filePath).then((res) => {
      if (cancelled) return;
      if (res.ok && typeof res.content === 'string') {
        setAgentsDoc(res.content);
        setAgentsDocExists(true);
      } else {
        setAgentsDoc(fallbackTemplate);
        setAgentsDocExists(false);
      }
      setAgentsDocLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, workspace, remoteVps, remoteVpsReady, t]);

  const handleNameBlur = useCallback(() => {
    if (!workspace) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === workspace.name) return;
    onRename(workspace.id, trimmed);
  }, [nameDraft, onRename, workspace]);

  const handlePickFolder = useCallback(async () => {
    if (!workspace) return;
    const res = await window.canvasWorkspace?.dialog.openFolder();
    if (!res?.ok || !res.folderPath) return;
    onSetRootFolder(workspace.id, res.folderPath);
  }, [onSetRootFolder, workspace]);

  const hasActiveRoot = Boolean(remoteVps || workspace?.rootFolder);

  const handleSaveDoc = useCallback(async () => {
    if (!workspace || !hasActiveRoot) return;
    setSavingDoc(true);
    setError(undefined);
    try {
      const res = remoteVps
        ? await window.canvasWorkspace?.remoteVps.writeWorkspaceDoc(workspace.id, agentsDoc, remoteVps.cwd)
        : await window.canvasWorkspace?.file.write(joinPath(workspace.rootFolder!, WORKSPACE_DOC_FILENAME), agentsDoc);
      if (!res?.ok) {
        setError(res?.error ?? t('workspaceSettings.saveFailed', { fileName: WORKSPACE_DOC_FILENAME }));
        return;
      }
      if (remoteVps && 'path' in res && typeof res.path === 'string') {
        setRemoteDocPath(res.path);
      }
      setAgentsDocExists(true);
      setSavedHint(true);
      window.setTimeout(() => setSavedHint(false), 1800);
    } finally {
      setSavingDoc(false);
    }
  }, [agentsDoc, hasActiveRoot, remoteVps, workspace, t]);

  const handleGenerate = useCallback(async () => {
    if (!workspace) return;
    const trimmed = intent.trim();
    if (!trimmed) return;

    const hasUserContent = agentsDoc.trim().length > 0
      && agentsDoc.trim() !== buildWorkspaceDocTemplate(workspace.name, {
        goal: t('workspaceSettings.goalPlaceholder'),
        status: t('workspaceSettings.statusPlaceholder'),
        notes: t('workspaceSettings.notesPlaceholder'),
      }).trim();
    if (hasUserContent) {
      const ok = await confirm({
        intent: 'danger',
        title: t('workspaceSettings.replaceConfirmTitle'),
        description: t('workspaceSettings.replaceConfirm'),
        confirmLabel: t('workspaceSettings.generate'),
      });
      if (!ok) return;
    }

    setGenerating(true);
    setError(undefined);
    const api = window.canvasWorkspace?.agent;
    if (!api) {
      setGenerating(false);
      return;
    }

    const startRes = await api.streamWorkspaceDoc({
      workspaceName: workspace.name,
      intent: trimmed,
      currentContent: hasUserContent ? agentsDoc : undefined,
    });
    if (!startRes.ok || !startRes.requestId) {
      setError(startRes.error ?? t('workspaceSettings.generationStartFailed'));
      setGenerating(false);
      return;
    }

    let buffer = '';
    setAgentsDoc('');
    const offDelta = api.onWorkspaceDocDelta(startRes.requestId, (delta) => {
      buffer += delta;
      setAgentsDoc(buffer);
    });
    const offComplete = api.onWorkspaceDocComplete(startRes.requestId, (result) => {
      offDelta();
      offComplete();
      setGenerating(false);
      if (!result.ok) {
        setError(result.error ?? t('workspaceSettings.generationFailed'));
        return;
      }
      if (typeof result.content === 'string') {
        setAgentsDoc(result.content);
      }
    });
  }, [agentsDoc, intent, workspace, confirm, t]);

  if (!workspace) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      kicker={t('workspaceSettings.kicker')}
      title={workspace.name}
      ariaLabel={t('workspaceSettings.ariaLabel')}
      width={640}
    >
      <div className="workspace-settings-body">
        {error && <div className="workspace-settings-error" role="alert">{error}</div>}

        <section className="workspace-settings-section">
          <div className="workspace-settings-section-title">{t('workspaceSettings.identity')}</div>
          <TextField
            label={t('workspaceSettings.name')}
            hint={`id: ${workspace.id}`}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </section>

        <section className="workspace-settings-section">
          <div className="workspace-settings-section-title">{t('workspaceSettings.environment')}</div>
          {window.canvasWorkspace?.remoteVps && (
            <FieldRow label={vpsCopy.envMode}>
              <SegmentedControl
                value={envMode}
                onChange={(id) => setEnvMode(id as 'local' | 'vps')}
                options={[
                  { id: 'local', label: vpsCopy.envLocal },
                  { id: 'vps', label: vpsCopy.envVps },
                ]}
              />
            </FieldRow>
          )}

          {envMode === 'vps' && window.canvasWorkspace?.remoteVps ? (
            <>
              <Suspense fallback={null}>
                <RemoteVpsCard
                  workspaceId={workspace.id}
                  currentConfig={remoteVps}
                  onConfigChange={handleRemoteVpsChange}
                />
              </Suspense>
              {remoteVps && (
                <FieldRow
                  label={t('workspaceSettings.rootFolder')}
                  hint={vpsCopy.rootFolderHint}
                >
                  <div className="workspace-settings-folder-row">
                    <div className="workspace-settings-folder-path" title={remoteVps.cwd || '~'}>
                      {remoteVps.cwd?.trim() || '~'}
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => setRemoteFolderPickerOpen(true)}
                    >
                      {t('workspaceSettings.changeFolder')}
                    </Button>
                  </div>
                </FieldRow>
              )}
            </>
          ) : remoteVps ? (
            <div className="workspace-settings-vps-notice">
              <span>
                {vpsCopy.switchBackLocalNotice(remoteVps.sshHost || remoteVps.endpoint || 'VPS')}
              </span>
              <Button variant="secondary" size="sm" onClick={() => void handleDisconnectToLocal()}>
                {vpsCopy.switchBackLocalAction}
              </Button>
            </div>
          ) : (
            <FieldRow label={t('workspaceSettings.rootFolder')} hint={t('workspaceSettings.rootFolderHint')}>
              <div className="workspace-settings-folder-row">
                <div className="workspace-settings-folder-path" title={workspace.rootFolder}>
                  {workspace.rootFolder ?? <em>{t('workspaceSettings.notSet')}</em>}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void handlePickFolder()}
                >
                  {workspace.rootFolder ? t('workspaceSettings.changeFolder') : t('workspaceSettings.setFolder')}
                </Button>
              </div>
            </FieldRow>
          )}
        </section>

        <section className="workspace-settings-section">
          <div className="workspace-settings-section-title">{t('workspaceSettings.intentState')}</div>
          {!hasActiveRoot ? (
            <div className="workspace-settings-empty">
              {t('workspaceSettings.setRootFirst')}
            </div>
          ) : !agentsDocLoaded ? (
            <div className="workspace-settings-empty">{t('workspaceSettings.loading')}</div>
          ) : (
            <>
              <div className="workspace-settings-generate-row">
                <input
                  className="workspace-settings-input workspace-settings-generate-input"
                  placeholder={t('workspaceSettings.generatePlaceholder')}
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e) && intent.trim() && !generating) {
                      e.preventDefault();
                      void handleGenerate();
                    }
                  }}
                  disabled={generating}
                />
                <Button
                  variant="secondary"
                  className="workspace-settings-generate-btn"
                  onClick={() => void handleGenerate()}
                  disabled={!intent.trim() || generating}
                >
                  {generating ? t('workspaceSettings.generating') : t('workspaceSettings.generate')}
                </Button>
              </div>
              <textarea
                className="workspace-settings-textarea"
                value={agentsDoc}
                rows={16}
                onChange={(e) => setAgentsDoc(e.target.value)}
                spellCheck={false}
                readOnly={generating}
              />
              <div className="workspace-settings-field-hint">
                {agentsDocExists ? t('workspaceSettings.savedAt') : t('workspaceSettings.willCreateAt')}{' '}
                <code>
                  {remoteVps
                    ? `VPS:${remoteDocPath ?? joinPath(remoteVps.cwd?.trim() || '~', WORKSPACE_DOC_FILENAME)}`
                    : joinPath(workspace.rootFolder!, WORKSPACE_DOC_FILENAME)}
                </code>{' '}
                · {t('workspaceSettings.injectedHint')}
              </div>
            </>
          )}
        </section>

        <section className="workspace-settings-section">
          <div className="workspace-settings-section-title">{t('settings.mcp.title')}</div>
          <McpManager scope={{ level: 'workspace', workspaceId: workspace.id }} showInherited />
        </section>
      </div>

      <div className="workspace-settings-footer">
        <Button variant="secondary" onClick={onClose}>
          {t('workspaceSettings.close')}
        </Button>
        <Button
          variant="primary"
          disabled={!hasActiveRoot || savingDoc || !agentsDocLoaded}
          onClick={() => void handleSaveDoc()}
        >
          {savingDoc ? t('workspaceSettings.saving') : savedHint ? t('workspaceSettings.saved') : t('workspaceSettings.saveDoc')}
        </Button>
      </div>
      {remoteVps && remoteFolderPickerOpen && (
        <Suspense fallback={null}>
          <RemoteFolderPickerModal
            open={remoteFolderPickerOpen}
            workspaceId={workspace.id}
            initialPath={remoteVps.cwd || '~'}
            onSelect={(folderPath) => { void handleRemoteFolderSelect(folderPath); }}
            onClose={() => setRemoteFolderPickerOpen(false)}
          />
        </Suspense>
      )}
    </Drawer>
  );
};
