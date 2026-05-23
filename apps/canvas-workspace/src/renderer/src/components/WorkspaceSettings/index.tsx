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
import { createPortal } from 'react-dom';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import './index.css';

interface Props {
  workspace: WorkspaceEntry | null;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onSetRootFolder: (id: string, folderPath: string) => void;
}

const WORKSPACE_DOC_FILENAME = 'pulse-workspace.md';

const buildWorkspaceDocTemplate = (workspaceName: string): string =>
  `# ${workspaceName}\n\n## Goal\n<What are we trying to accomplish in this workspace?>\n\n## Status\n<Where are we right now? What's next?>\n\n## Notes\n<Decisions, references, open questions — both you and the agent edit this freely.>\n`;

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
        setAgentsDoc(buildWorkspaceDocTemplate(workspace.name));
        setAgentsDocExists(false);
      }
      setAgentsDocLoaded(true);
    });
  }, [open, workspace]);

  // ESC closes the drawer.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

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
        setError(res?.error ?? `Failed to save ${WORKSPACE_DOC_FILENAME}`);
        return;
      }
      setAgentsDocExists(true);
      setSavedHint(true);
      window.setTimeout(() => setSavedHint(false), 1800);
    } finally {
      setSavingDoc(false);
    }
  }, [agentsDoc, workspace]);

  const handleGenerate = useCallback(async () => {
    if (!workspace) return;
    const trimmed = intent.trim();
    if (!trimmed) return;

    const hasUserContent = agentsDoc.trim().length > 0
      && agentsDoc.trim() !== buildWorkspaceDocTemplate(workspace.name).trim();
    if (hasUserContent) {
      const ok = window.confirm(
        'Replace the current pulse-workspace.md draft with an AI-generated one?\nThe existing content will be sent to the model as context so good parts can be kept.',
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
      setError(startRes.error ?? 'Failed to start generation');
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
        setError(result.error ?? 'Generation failed');
        return;
      }
      if (typeof result.content === 'string') {
        setAgentsDoc(result.content);
      }
    });
  }, [agentsDoc, intent, workspace]);

  if (!open || !workspace) return null;

  return createPortal(
    <div className="workspace-settings-backdrop" onMouseDown={onClose}>
      <aside
        className="workspace-settings"
        onMouseDown={(event) => event.stopPropagation()}
        aria-label="Workspace settings"
      >
        <div className="workspace-settings-header">
          <div>
            <div className="workspace-settings-kicker">Workspace Settings</div>
            <h2>{workspace.name}</h2>
          </div>
          <button
            type="button"
            className="workspace-settings-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="workspace-settings-body">
          {error && <div className="workspace-settings-error">{error}</div>}

          <section className="workspace-settings-section">
            <div className="workspace-settings-section-title">Identity</div>
            <label className="workspace-settings-field">
              <span>Name</span>
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
            <div className="workspace-settings-section-title">Environment</div>
            <div className="workspace-settings-field">
              <span>Root folder</span>
              <div className="workspace-settings-folder-row">
                <div className="workspace-settings-folder-path" title={workspace.rootFolder}>
                  {workspace.rootFolder ?? <em>not set</em>}
                </div>
                <button
                  type="button"
                  className="workspace-settings-secondary-btn"
                  onClick={() => void handlePickFolder()}
                >
                  {workspace.rootFolder ? 'Change…' : 'Set folder…'}
                </button>
              </div>
              <div className="workspace-settings-field-hint">
                The directory where this workspace's work lives. <code>pulse-workspace.md</code> is
                read/written here. Optional — leave empty for pure-thinking workspaces.
              </div>
            </div>
          </section>

          <section className="workspace-settings-section">
            <div className="workspace-settings-section-title">Intent &amp; State (pulse-workspace.md)</div>
            {!workspace.rootFolder ? (
              <div className="workspace-settings-empty">
                Set a root folder first — <code>pulse-workspace.md</code> lives inside it so both
                you and the agent can read it.
              </div>
            ) : !agentsDocLoaded ? (
              <div className="workspace-settings-empty">Loading…</div>
            ) : (
              <>
                <div className="workspace-settings-generate-row">
                  <input
                    className="workspace-settings-input workspace-settings-generate-input"
                    placeholder="Describe what this workspace is for, AI will draft a pulse-workspace.md…"
                    value={intent}
                    onChange={(e) => setIntent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && intent.trim() && !generating) {
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
                    {generating ? 'Generating…' : '✨ Generate'}
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
                  {agentsDocExists ? 'Saved at ' : 'Will be created at '}
                  <code>{joinPath(workspace.rootFolder, WORKSPACE_DOC_FILENAME)}</code> · injected
                  into the Canvas Agent's system prompt every turn.
                </div>
              </>
            )}
          </section>
        </div>

        <div className="workspace-settings-footer">
          <button type="button" className="workspace-settings-secondary-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="workspace-settings-primary-btn"
            disabled={!workspace.rootFolder || savingDoc || !agentsDocLoaded}
            onClick={() => void handleSaveDoc()}
          >
            {savingDoc ? 'Saving…' : savedHint ? 'Saved ✓' : 'Save pulse-workspace.md'}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
};
