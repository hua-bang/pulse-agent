/**
 * Workspace settings drawer — per-workspace meta + environment + intent.
 *
 * Three sections, mirroring the long-term workspace model:
 *  1. Identity   — name (editable)
 *  2. Environment — rootFolder (the directory where work lands)
 *  3. Intent & State — the workspace context document (shared brain for
 *     human + Canvas Agent)
 *
 * The document lives in Canvas storage, not in the root folder, so neither
 * side writes into the user's project to keep it current. Its content is
 * injected into the Canvas Agent's system prompt on every chat turn (see
 * main/agent/workspace/workspace-context.ts).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../../../../shared/workspaces';
import { Drawer, Button, TextField, FieldRow } from '../../../../components/ui';
import { McpManager } from '../settings-config/McpManager';
import { useAppShell } from '../../../../shared/appShell';
import { useI18n } from '../../../../i18n';
import { isImeComposing } from '../../../../utils/ime';
import './index.css';

interface Props {
  workspace: WorkspaceEntry | null;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onSetRootFolder: (id: string, folderPath: string) => void;
}

const buildWorkspaceDocTemplate = (
  workspaceName: string,
  labels: { goal: string; status: string; notes: string },
): string =>
  `# ${workspaceName}\n\n## Goal\n<${labels.goal}>\n\n## Status\n<${labels.status}>\n\n## Notes\n<${labels.notes}>\n`;

export const WorkspaceSettingsDrawer = ({
  workspace,
  onClose,
  onRename,
  onSetRootFolder,
}: Props) => {
  const { t } = useI18n();
  const { confirm } = useAppShell();
  const open = workspace !== null;

  const [nameDraft, setNameDraft] = useState('');
  const [agentsDoc, setAgentsDoc] = useState('');
  const [agentsDocLoaded, setAgentsDocLoaded] = useState(false);
  // Storage revision as last read or saved (null: not saved yet). Saves
  // compare against it so an agent update made meanwhile is not lost.
  const [docRevision, setDocRevision] = useState<number | null>(null);
  const [savingDoc, setSavingDoc] = useState(false);
  const [error, setError] = useState<string>();
  const [savedHint, setSavedHint] = useState(false);
  const [intent, setIntent] = useState('');
  const [generating, setGenerating] = useState(false);
  const initializedRef = useRef(false);

  // Reload state whenever the drawer (re)opens for a workspace.
  useEffect(() => {
    if (!open || !workspace) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;
    setNameDraft(workspace.name);
    setError(undefined);
    setSavedHint(false);
    setAgentsDocLoaded(false);
    setIntent('');
    setGenerating(false);

    void window.canvasWorkspace?.agent.readWorkspaceContext(workspace.id).then((res) => {
      if (!res.ok) {
        setError(res.error ?? t('workspaceSettings.loadFailed'));
        return;
      }
      setDocRevision(res.revision ?? null);
      if (res.content?.trim()) {
        setAgentsDoc(res.content);
      } else {
        setAgentsDoc(buildWorkspaceDocTemplate(workspace.name, {
          goal: t('workspaceSettings.goalPlaceholder'),
          status: t('workspaceSettings.statusPlaceholder'),
          notes: t('workspaceSettings.notesPlaceholder'),
        }));
      }
      setAgentsDocLoaded(true);
    });
  }, [open, workspace, t]);

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

  const handleSaveDoc = useCallback(async () => {
    if (!workspace) return;
    setSavingDoc(true);
    setError(undefined);
    try {
      const res = await window.canvasWorkspace?.agent.writeWorkspaceContext(workspace.id, agentsDoc, docRevision);
      if (!res?.ok || res.revision === undefined) {
        setError(res?.conflict
          ? t('workspaceSettings.saveConflict')
          : res?.error ?? t('workspaceSettings.saveFailed'));
        return;
      }
      setDocRevision(res.revision);
      setSavedHint(true);
      window.setTimeout(() => setSavedHint(false), 1800);
    } finally {
      setSavingDoc(false);
    }
  }, [agentsDoc, docRevision, workspace, t]);

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
        {error && <div className="workspace-settings-error">{error}</div>}

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
        </section>

        <section className="workspace-settings-section">
          <div className="workspace-settings-section-title">{t('workspaceSettings.intentState')}</div>
          {!agentsDocLoaded ? (
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
                {t('workspaceSettings.storageHint')} · {t('workspaceSettings.injectedHint')}
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
          disabled={savingDoc || !agentsDocLoaded}
          onClick={() => void handleSaveDoc()}
        >
          {savingDoc ? t('workspaceSettings.saving') : savedHint ? t('workspaceSettings.saved') : t('workspaceSettings.saveDoc')}
        </Button>
      </div>
    </Drawer>
  );
};
