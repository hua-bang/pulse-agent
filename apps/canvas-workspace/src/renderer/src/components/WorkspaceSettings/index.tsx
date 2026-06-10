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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { SettingsDrawer } from '../SettingsDrawer';
import { SkillsManager } from '../settings-config/SkillsManager';
import { McpManager } from '../settings-config/McpManager';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';
import './index.css';

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
  const { t } = useI18n();
  const open = workspace !== null;

  const [nameDraft, setNameDraft] = useState('');
  const [agentsDoc, setAgentsDoc] = useState('');
  const [agentsDocLoaded, setAgentsDocLoaded] = useState(false);
  const [agentsDocExists, setAgentsDocExists] = useState(false);
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

    if (!workspace.rootFolder) {
      setAgentsDoc('');
      setAgentsDocExists(false);
      setAgentsDocLoaded(true);
      return;
    }

    const filePath = joinPath(workspace.rootFolder, WORKSPACE_DOC_FILENAME);
    void window.canvasWorkspace?.file.read(filePath).then((res) => {
      if (res.ok && typeof res.content === 'string') {
        setAgentsDoc(res.content);
        setAgentsDocExists(true);
      } else {
        setAgentsDoc(buildWorkspaceDocTemplate(workspace.name, {
          goal: t('workspaceSettings.goalPlaceholder'),
          status: t('workspaceSettings.statusPlaceholder'),
          notes: t('workspaceSettings.notesPlaceholder'),
        }));
        setAgentsDocExists(false);
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
    // Trigger pulse-workspace.md reload from the new location.
    initializedRef.current = false;
  }, [onSetRootFolder, workspace]);

  const handleSaveDoc = useCallback(async () => {
    if (!workspace?.rootFolder) return;
    setSavingDoc(true);
    setError(undefined);
    try {
      const filePath = joinPath(workspace.rootFolder, WORKSPACE_DOC_FILENAME);
      const res = await window.canvasWorkspace?.file.write(filePath, agentsDoc);
      if (!res?.ok) {
        setError(res?.error ?? t('workspaceSettings.saveFailed', { fileName: WORKSPACE_DOC_FILENAME }));
        return;
      }
      setAgentsDocExists(true);
      setSavedHint(true);
      window.setTimeout(() => setSavedHint(false), 1800);
    } finally {
      setSavingDoc(false);
    }
  }, [agentsDoc, workspace, t]);

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
      const ok = window.confirm(
        t('workspaceSettings.replaceConfirm'),
      );
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
  }, [agentsDoc, intent, workspace, t]);

  if (!workspace) return null;

  return (
    <SettingsDrawer
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
          <label className="workspace-settings-field">
            <span>{t('workspaceSettings.name')}</span>
            <input
              className="workspace-settings-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <div className="workspace-settings-field-hint">id: {workspace.id}</div>
        </section>

        <section className="workspace-settings-section">
          <div className="workspace-settings-section-title">{t('workspaceSettings.environment')}</div>
          <div className="workspace-settings-field">
            <span>{t('workspaceSettings.rootFolder')}</span>
            <div className="workspace-settings-folder-row">
              <div className="workspace-settings-folder-path" title={workspace.rootFolder}>
                {workspace.rootFolder ?? <em>{t('workspaceSettings.notSet')}</em>}
              </div>
              <button
                type="button"
                className="workspace-settings-secondary-btn"
                onClick={() => void handlePickFolder()}
              >
                {workspace.rootFolder ? t('workspaceSettings.changeFolder') : t('workspaceSettings.setFolder')}
              </button>
            </div>
            <div className="workspace-settings-field-hint">
              {t('workspaceSettings.rootFolderHint')}
            </div>
          </div>
        </section>

        <section className="workspace-settings-section">
          <div className="workspace-settings-section-title">{t('workspaceSettings.intentState')}</div>
          {!workspace.rootFolder ? (
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
                <button
                  type="button"
                  className="workspace-settings-secondary-btn workspace-settings-generate-btn"
                  onClick={() => void handleGenerate()}
                  disabled={!intent.trim() || generating}
                >
                  {generating ? t('workspaceSettings.generating') : t('workspaceSettings.generate')}
                </button>
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
                <code>{joinPath(workspace.rootFolder, WORKSPACE_DOC_FILENAME)}</code> · {t('workspaceSettings.injectedHint')}
              </div>
            </>
          )}
        </section>

        <section className="workspace-settings-section">
          <div className="workspace-settings-section-title">{t('settings.skills.title')}</div>
          <div className="workspace-settings-field-hint">{t('skillsConfig.scopeHint.workspace')}</div>
          <SkillsManager scope={{ level: 'workspace', workspaceId: workspace.id }} showInherited />
        </section>

        <section className="workspace-settings-section">
          <div className="workspace-settings-section-title">{t('settings.mcp.title')}</div>
          <McpManager scope={{ level: 'workspace', workspaceId: workspace.id }} showInherited />
        </section>
      </div>

      <div className="workspace-settings-footer">
        <button type="button" className="workspace-settings-secondary-btn" onClick={onClose}>
          {t('workspaceSettings.close')}
        </button>
        <button
          type="button"
          className="workspace-settings-primary-btn"
          disabled={!workspace.rootFolder || savingDoc || !agentsDocLoaded}
          onClick={() => void handleSaveDoc()}
        >
          {savingDoc ? t('workspaceSettings.saving') : savedHint ? t('workspaceSettings.saved') : t('workspaceSettings.saveDoc')}
        </button>
      </div>
    </SettingsDrawer>
  );
};
