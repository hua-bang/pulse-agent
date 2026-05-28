/**
 * Scope-aware wrappers around <McpEditor> / <SkillsEditor> that handle
 * the load → render → reload-after-save dance. Pass in a scope and they
 * fetch the on-disk config for it, render the editor, and re-fetch
 * after a save (so the editor stays in sync if the file watcher fires).
 *
 * Use these directly from settings drawers — no need to manage state in
 * the parent.
 */

import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceConfigScope, WorkspaceSkillEntry } from '../../types';
import { McpEditor, SkillsEditor } from './index';

interface ScopedProps {
  scope: WorkspaceConfigScope;
}

export const ScopedMcpEditor = ({ scope }: ScopedProps) => {
  const [text, setText] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await window.canvasWorkspace.workspaceConfig.getScope(scope);
    if (!res.ok || !res.scope) {
      setError(res.error ?? 'Failed to load config');
      setText('');
    } else {
      const mcp = res.scope.mcp;
      // Pretty-print so users see something sane on first open.
      setText(
        mcp.mcpServers && Object.keys(mcp.mcpServers).length > 0
          ? JSON.stringify(mcp, null, 2)
          : '',
      );
    }
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="workspace-config-empty">Loading…</div>;
  if (error) return <div className="workspace-config-error">{error}</div>;
  return <McpEditor scope={scope} initialText={text} onSaved={load} />;
};

export const ScopedSkillsEditor = ({ scope }: ScopedProps) => {
  const [skills, setSkills] = useState<WorkspaceSkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await window.canvasWorkspace.workspaceConfig.getScope(scope);
    if (!res.ok || !res.scope) {
      setError(res.error ?? 'Failed to load config');
      setSkills([]);
    } else {
      setSkills(res.scope.skills.skills ?? []);
    }
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="workspace-config-empty">Loading…</div>;
  if (error) return <div className="workspace-config-error">{error}</div>;
  return <SkillsEditor scope={scope} initialSkills={skills} onSaved={load} />;
};
