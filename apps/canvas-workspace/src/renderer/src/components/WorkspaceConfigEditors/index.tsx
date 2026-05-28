/**
 * MCP + Skills config editors — shared between the global Settings
 * drawer and the per-workspace WorkspaceSettings drawer. The only
 * difference between the two surfaces is the `scope` prop passed in:
 *   - { kind: 'global' }                 → ~/.pulse-coder/canvas/global/
 *   - { kind: 'workspace', workspaceId } → ~/.pulse-coder/canvas/<id>/
 *
 * Saves write JSON to disk via IPC; the engine plugin's fs watcher
 * picks the change up and reconciles before the next agent turn — so
 * the user never sees a "restart session" prompt.
 *
 * MCP UI is intentionally a raw JSON editor (per the PR-1 plan): power
 * users want full control, validation happens at save time. Skills UI
 * is structured because the source types (inline / url / git) are too
 * easy to mistype in raw JSON.
 */

import { useCallback, useEffect, useState } from 'react';
import type {
  WorkspaceConfigScope,
  WorkspaceSkillEntry,
  WorkspaceSkillSource,
} from '../../types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const MCP_PLACEHOLDER = `{
  "mcpServers": {
    "time": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-time"]
    }
  }
}`;

function describeScope(scope: WorkspaceConfigScope): string {
  return scope.kind === 'global' ? 'global' : `workspace ${scope.workspaceId}`;
}

// ---------------------------------------------------------------------------
// MCP editor
// ---------------------------------------------------------------------------

interface McpEditorProps {
  scope: WorkspaceConfigScope;
  /** Initial JSON text to seed the editor. Pass '' when no config yet. */
  initialText: string;
  /** Called after a successful save. Lets the parent re-fetch merged config. */
  onSaved?: () => void;
}

export const McpEditor = ({ scope, initialText, onSaved }: McpEditorProps) => {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset when scope flips (global → workspace tab).
  useEffect(() => {
    setText(initialText);
    setError(null);
    setSaved(false);
  }, [initialText, scope.kind, (scope as { workspaceId?: string }).workspaceId]);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaved(false);
    let parsed: unknown;
    try {
      parsed = text.trim() ? JSON.parse(text) : { mcpServers: {} };
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      setError('Top-level value must be an object with an "mcpServers" key.');
      return;
    }
    setSaving(true);
    try {
      const res = await window.canvasWorkspace.workspaceConfig.saveMcp(
        scope,
        parsed as { mcpServers?: Record<string, unknown> },
      );
      if (!res.ok) {
        setError(res.error ?? 'Save failed');
        return;
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [text, scope, onSaved]);

  return (
    <div className="workspace-config-editor">
      <textarea
        className="workspace-config-textarea workspace-config-textarea--mono"
        value={text}
        rows={14}
        placeholder={MCP_PLACEHOLDER}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="workspace-config-editor-hint">
        Edits {describeScope(scope)} MCP servers. Workspace-level entries
        override global on name collision.
      </div>
      {error && <div className="workspace-config-error">{error}</div>}
      <div className="workspace-config-editor-row">
        <button
          type="button"
          className="workspace-config-primary-btn"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save MCP'}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Skills editor
// ---------------------------------------------------------------------------

type SkillSourceType = WorkspaceSkillSource['type'];

interface SkillsEditorProps {
  scope: WorkspaceConfigScope;
  /** Skills currently saved at this scope (NOT the merged view). */
  initialSkills: WorkspaceSkillEntry[];
  onSaved?: () => void;
}

function newEmptySkill(): WorkspaceSkillEntry {
  return { name: '', description: '', source: { type: 'inline', content: '' } };
}

function switchSourceType(
  current: WorkspaceSkillSource,
  type: SkillSourceType,
): WorkspaceSkillSource {
  if (current.type === type) return current;
  switch (type) {
    case 'inline':
      return { type: 'inline', content: '' };
    case 'url':
      return { type: 'url', url: '' };
    case 'git':
      return { type: 'git', url: '' };
  }
}

export const SkillsEditor = ({ scope, initialSkills, onSaved }: SkillsEditorProps) => {
  const [skills, setSkills] = useState<WorkspaceSkillEntry[]>(initialSkills);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [preview, setPreview] = useState<{
    index: number;
    name: string;
    description: string;
    content: string;
  } | null>(null);

  useEffect(() => {
    setSkills(initialSkills);
    setError(null);
    setSaved(false);
    setPreview(null);
  }, [initialSkills, scope.kind, (scope as { workspaceId?: string }).workspaceId]);

  const updateSkill = useCallback(
    (index: number, mut: (s: WorkspaceSkillEntry) => WorkspaceSkillEntry) => {
      setSkills((prev) => prev.map((s, i) => (i === index ? mut(s) : s)));
    },
    [],
  );

  const removeSkill = useCallback((index: number) => {
    setSkills((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addSkill = useCallback(() => {
    setSkills((prev) => [...prev, newEmptySkill()]);
  }, []);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaved(false);
    // Surface obvious errors before round-tripping IPC.
    for (const [i, s] of skills.entries()) {
      if (!s.name.trim()) {
        setError(`Skill #${i + 1}: name is required`);
        return;
      }
      if (s.source.type !== 'inline' && !s.source.url.trim()) {
        setError(`Skill "${s.name}": url is required for ${s.source.type} sources`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await window.canvasWorkspace.workspaceConfig.saveSkills(scope, { skills });
      if (!res.ok) {
        setError(res.error ?? 'Save failed');
        return;
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [skills, scope, onSaved]);

  const handlePreview = useCallback(
    async (index: number) => {
      setPreviewing(index);
      setError(null);
      try {
        const res = await window.canvasWorkspace.workspaceConfig.fetchSkillPreview(
          skills[index],
        );
        if (!res.ok || !res.preview) {
          setError(res.error ?? 'Preview failed');
          setPreview(null);
          return;
        }
        setPreview({ index, ...res.preview });
      } finally {
        setPreviewing(null);
      }
    },
    [skills],
  );

  return (
    <div className="workspace-config-editor">
      {skills.length === 0 ? (
        <div className="workspace-config-empty">
          No skills configured at this scope. Add one below.
        </div>
      ) : (
        <ul className="workspace-config-skill-list">
          {skills.map((skill, i) => (
            <li key={i} className="workspace-config-skill-item">
              <div className="workspace-config-skill-row">
                <input
                  className="workspace-config-input"
                  placeholder="Name (required)"
                  value={skill.name}
                  onChange={(e) =>
                    updateSkill(i, (s) => ({ ...s, name: e.target.value }))
                  }
                />
                <select
                  className="workspace-config-input"
                  value={skill.source.type}
                  onChange={(e) =>
                    updateSkill(i, (s) => ({
                      ...s,
                      source: switchSourceType(s.source, e.target.value as SkillSourceType),
                    }))
                  }
                >
                  <option value="inline">inline</option>
                  <option value="url">url</option>
                  <option value="git">git</option>
                </select>
                <button
                  type="button"
                  className="workspace-config-link-btn"
                  onClick={() => removeSkill(i)}
                  aria-label="Remove skill"
                >
                  Remove
                </button>
              </div>
              <input
                className="workspace-config-input"
                placeholder="Description (optional, falls back to SKILL.md frontmatter)"
                value={skill.description ?? ''}
                onChange={(e) =>
                  updateSkill(i, (s) => ({ ...s, description: e.target.value }))
                }
              />
              {skill.source.type === 'inline' && (
                <textarea
                  className="workspace-config-textarea workspace-config-textarea--mono"
                  placeholder={'---\nname: my-skill\ndescription: …\n---\n\n# Instructions…'}
                  rows={5}
                  value={skill.source.content}
                  onChange={(e) =>
                    updateSkill(i, (s) => ({
                      ...s,
                      source: { type: 'inline', content: e.target.value },
                    }))
                  }
                />
              )}
              {skill.source.type === 'url' && (
                <input
                  className="workspace-config-input"
                  placeholder="https://…/SKILL.md"
                  value={skill.source.url}
                  onChange={(e) =>
                    updateSkill(i, (s) => ({
                      ...s,
                      source: { type: 'url', url: e.target.value },
                    }))
                  }
                />
              )}
              {skill.source.type === 'git' && (
                <div className="workspace-config-skill-row">
                  <input
                    className="workspace-config-input"
                    placeholder="https://github.com/owner/repo.git"
                    value={skill.source.url}
                    onChange={(e) =>
                      updateSkill(i, (s) => ({
                        ...s,
                        source: {
                          type: 'git',
                          url: e.target.value,
                          ref: (s.source as { ref?: string }).ref,
                          path: (s.source as { path?: string }).path,
                        },
                      }))
                    }
                  />
                  <input
                    className="workspace-config-input"
                    placeholder="ref (optional)"
                    value={(skill.source as { ref?: string }).ref ?? ''}
                    onChange={(e) =>
                      updateSkill(i, (s) => ({
                        ...s,
                        source: { ...(s.source as { type: 'git'; url: string }), ref: e.target.value, type: 'git' },
                      }))
                    }
                  />
                  <input
                    className="workspace-config-input"
                    placeholder="path in repo (default SKILL.md)"
                    value={(skill.source as { path?: string }).path ?? ''}
                    onChange={(e) =>
                      updateSkill(i, (s) => ({
                        ...s,
                        source: { ...(s.source as { type: 'git'; url: string }), path: e.target.value, type: 'git' },
                      }))
                    }
                  />
                </div>
              )}
              {skill.source.type !== 'inline' && (
                <button
                  type="button"
                  className="workspace-config-secondary-btn"
                  disabled={previewing === i}
                  onClick={() => void handlePreview(i)}
                >
                  {previewing === i ? 'Fetching…' : 'Preview'}
                </button>
              )}
              {preview && preview.index === i && (
                <div className="workspace-config-preview">
                  <div className="workspace-config-preview-meta">
                    <strong>{preview.name}</strong>
                    {preview.description && <span> — {preview.description}</span>}
                  </div>
                  <pre className="workspace-config-preview-body">{preview.content}</pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <div className="workspace-config-error">{error}</div>}
      <div className="workspace-config-editor-row">
        <button
          type="button"
          className="workspace-config-secondary-btn"
          onClick={addSkill}
        >
          + Add skill
        </button>
        <button
          type="button"
          className="workspace-config-primary-btn"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save skills'}
        </button>
      </div>
      <div className="workspace-config-editor-hint">
        Edits {describeScope(scope)} skills. Workspace overrides global on
        name collision. Remote skills are fetched on the next agent turn.
      </div>
    </div>
  );
};
