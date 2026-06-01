/**
 * SkillsManager — CRUD UI for user-defined skills at a given scope.
 * Reused by the global Settings panel and the per-workspace settings drawer.
 *
 * Onboarding paths, ordered by friction:
 *   1. Drag-and-drop a `.md` or `.zip` onto the manager surface (lowest)
 *   2. Paste a full SKILL.md into the inline textarea
 *   3. Click "Import .zip" to file-pick a bundle
 *   4. "+ Add skill" for a from-scratch form
 */

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { CanvasConfigScope, CanvasSkillEntry } from '../../types';
import { useI18n } from '../../i18n';
import { useAppShell } from '../AppShellProvider';
import './settings-config.css';

interface Props {
  scope: CanvasConfigScope;
  /**
   * When true and `scope` is a workspace, also show the global skills the
   * agent inherits — read-only, with an "overridden by this workspace"
   * badge on any name collisions. The agent's actual loaded skill set is
   * (workspace ∪ global) with workspace winning on same-name, so surfacing
   * the global half here keeps the panel honest about what's loaded.
   */
  showInherited?: boolean;
}

interface Draft {
  originalName?: string;
  name: string;
  description: string;
  body: string;
}

const EMPTY_DRAFT: Draft = { name: '', description: '', body: '' };

export const SkillsManager = ({ scope, showInherited = false }: Props) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const [skills, setSkills] = useState<CanvasSkillEntry[]>([]);
  const [inherited, setInherited] = useState<CanvasSkillEntry[]>([]);
  const [dir, setDir] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [mdText, setMdText] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Drag/leave fires per descendant. Count entries so the overlay only hides
  // when the cursor truly leaves the manager surface.
  const dragDepth = useRef(0);
  const scopeKey = scope.level === 'workspace' ? scope.workspaceId : 'global';
  const inheritedEnabled = showInherited && scope.level === 'workspace';

  const load = useCallback(async () => {
    const res = await window.canvasWorkspace.canvasSkills.list(scope);
    if (res.ok && res.status) {
      setSkills(res.status.skills);
      setDir(res.status.dir);
    } else {
      notify({ tone: 'error', title: t('skillsConfig.loadFailed'), description: res.error ?? '' });
    }
    if (inheritedEnabled) {
      const g = await window.canvasWorkspace.canvasSkills.list({ level: 'global' });
      if (g.ok && g.status) setInherited(g.status.skills);
    } else {
      setInherited([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, inheritedEnabled, t]);

  useEffect(() => {
    setDraft(null);
    setMdText(null);
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.description.trim()) {
      notify({ tone: 'error', title: t('skillsConfig.nameRequired') });
      return;
    }
    setSaving(true);
    try {
      const res = await window.canvasWorkspace.canvasSkills.upsert(scope, draft);
      if (res.ok && res.status) {
        setSkills(res.status.skills);
        setDraft(null);
      } else {
        notify({ tone: 'error', title: res.error ?? t('skillsConfig.loadFailed') });
      }
    } finally {
      setSaving(false);
    }
  }, [draft, scope, notify, t]);

  const remove = useCallback(
    async (name: string) => {
      if (!window.confirm(t('skillsConfig.deleteConfirm', { name }))) return;
      const res = await window.canvasWorkspace.canvasSkills.remove(scope, name);
      if (res.ok && res.status) setSkills(res.status.skills);
      else notify({ tone: 'error', title: res.error ?? t('skillsConfig.loadFailed') });
    },
    [scope, notify, t],
  );

  // Shared toast/state handlers. Both .zip and a URL that resolves to a zip
  // come back as an entries[] summary; both .md and a URL that resolves to
  // a SKILL.md come back as a single named result. Keeping the two display
  // paths in helpers means the URL dispatcher below can just hand off based
  // on which kind the backend ran.
  type ImportResponse = Awaited<ReturnType<typeof window.canvasWorkspace.canvasSkills.importUrl>>;
  const handleZipResult = useCallback(
    (res: ImportResponse) => {
      if (!res.ok || !res.status) {
        notify({ tone: 'error', title: t('skillsConfig.importFailed'), description: res.error });
        return;
      }
      setSkills(res.status.skills);
      const entries = res.entries ?? [];
      const counts = { imported: 0, replaced: 0, skipped: 0 };
      for (const e of entries) counts[e.status] += 1;
      notify({
        tone: counts.skipped > 0 && counts.imported + counts.replaced === 0 ? 'error' : 'success',
        title: t('skillsConfig.importDone', counts),
        description: entries
          .filter((e) => e.status === 'skipped')
          .map((e) => `${e.name}: ${e.reason ?? ''}`)
          .join('\n') || undefined,
      });
    },
    [notify, t],
  );
  const handleMdResult = useCallback(
    (res: ImportResponse) => {
      if (!res.ok || !res.status) {
        notify({ tone: 'error', title: t('skillsConfig.importFailed'), description: res.error });
        return;
      }
      setSkills(res.status.skills);
      notify({
        tone: 'success',
        title: t(
          res.result === 'replaced' ? 'skillsConfig.importMdReplaced' : 'skillsConfig.importMdDone',
          { name: res.name ?? '' },
        ),
      });
      setMdText(null);
    },
    [notify, t],
  );

  const runZipImport = useCallback(
    async (bytes: ArrayBuffer) => {
      handleZipResult(await window.canvasWorkspace.canvasSkills.importZip(scope, bytes));
    },
    [scope, handleZipResult],
  );

  const runPasteImport = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;
      // Single text field, two underlying paths: a `^https?://` prefix routes
      // to the URL importer (which itself may resolve to .md or .zip),
      // anything else is treated as raw SKILL.md content.
      if (/^https?:\/\//i.test(trimmed)) {
        const res = await window.canvasWorkspace.canvasSkills.importUrl(scope, trimmed);
        if (res.ok && res.kind === 'zip') handleZipResult(res);
        else handleMdResult(res);
      } else {
        handleMdResult(await window.canvasWorkspace.canvasSkills.importMd(scope, trimmed));
      }
    },
    [scope, handleZipResult, handleMdResult],
  );

  const handleFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      setImporting(true);
      try {
        if (lower.endsWith('.zip')) {
          await runZipImport(await file.arrayBuffer());
        } else if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
          await runPasteImport(await file.text());
        } else {
          notify({ tone: 'error', title: t('skillsConfig.dropUnsupported') });
        }
      } finally {
        setImporting(false);
      }
    },
    [runZipImport, runPasteImport, notify, t],
  );

  // Drop targets: a file from the OS (.md / .zip) or a URL from the browser
  // address bar / a link drag. `Files` and `text/uri-list` are the relevant
  // dataTransfer types — checking both keeps the overlay from flickering
  // when the user drags text selections we don't care about.
  const isAcceptedDrag = (e: DragEvent<HTMLDivElement>): boolean => {
    const types = Array.from(e.dataTransfer.types);
    return types.includes('Files') || types.includes('text/uri-list');
  };

  const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!isAcceptedDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (isAcceptedDrag(e)) e.preventDefault();
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!isAcceptedDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }, []);

  const onDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      if (!isAcceptedDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      // Files take priority — if both a File and a URL are present (rare),
      // the file is the more reliable artifact.
      const file = e.dataTransfer.files[0];
      if (file) {
        await handleFile(file);
        return;
      }
      // `text/uri-list` may contain multiple URLs separated by CRLF and
      // comments prefixed with `#`. Take the first non-comment line.
      const uriList = e.dataTransfer.getData('text/uri-list');
      const url = uriList
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#'));
      if (url) {
        setImporting(true);
        try {
          await runPasteImport(url);
        } finally {
          setImporting(false);
        }
      }
    },
    [handleFile, runPasteImport],
  );

  // Case-insensitive substring filter over name + description.
  const matches = useCallback(
    (skill: CanvasSkillEntry): boolean => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q)
      );
    },
    [query],
  );
  const filteredSkills = skills.filter(matches);
  const filteredInherited = inherited.filter(matches);
  const showSearch = skills.length + inherited.length >= 8;

  return (
    <div
      className={`cfg-manager${dragOver ? ' cfg-manager--drag' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragOver && <div className="cfg-drop-overlay">{t('skillsConfig.dropHere')}</div>}
      <div className="cfg-toolbar">
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleFile(file);
          }}
        />
        <button
          type="button"
          className="cfg-secondary-btn"
          onClick={() => setMdText(mdText === null ? '' : null)}
          disabled={importing || draft !== null}
        >
          {t('skillsConfig.importMd')}
        </button>
        <button
          type="button"
          className="cfg-secondary-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing || draft !== null || mdText !== null}
        >
          {importing ? t('skillsConfig.importing') : t('skillsConfig.importZip')}
        </button>
        <button
          type="button"
          className="cfg-secondary-btn"
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
          disabled={draft !== null || importing || mdText !== null}
        >
          + {t('skillsConfig.add')}
        </button>
      </div>

      {mdText !== null && (
        <div className="cfg-form">
          <label className="cfg-field">
            <span>{t('skillsConfig.importMdLabel')}</span>
            <textarea
              className="cfg-textarea"
              rows={10}
              value={mdText}
              placeholder={t('skillsConfig.importMdPlaceholder')}
              spellCheck={false}
              autoFocus
              onChange={(e) => setMdText(e.target.value)}
            />
            <div className="cfg-toolbar-hint" style={{ flex: 'none', marginTop: 4 }}>
              {t('skillsConfig.importMdHint')}
            </div>
          </label>
          <div className="cfg-form-actions">
            <button
              type="button"
              className="cfg-secondary-btn"
              onClick={() => setMdText(null)}
              disabled={importing}
            >
              {t('skillsConfig.cancel')}
            </button>
            <button
              type="button"
              className="cfg-primary-btn"
              onClick={() => void runPasteImport(mdText)}
              disabled={importing || !mdText.trim()}
            >
              {importing ? t('skillsConfig.importing') : t('skillsConfig.save')}
            </button>
          </div>
        </div>
      )}

      {draft && (
        <div className="cfg-form">
          <label className="cfg-field">
            <span>{t('skillsConfig.name')}</span>
            <input
              className="cfg-input"
              value={draft.name}
              placeholder={t('skillsConfig.namePlaceholder')}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="cfg-field">
            <span>{t('skillsConfig.description')}</span>
            <input
              className="cfg-input"
              value={draft.description}
              placeholder={t('skillsConfig.descriptionPlaceholder')}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <label className="cfg-field">
            <span>{t('skillsConfig.body')}</span>
            <textarea
              className="cfg-textarea"
              rows={10}
              value={draft.body}
              placeholder={t('skillsConfig.bodyPlaceholder')}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          <div className="cfg-form-actions">
            <button type="button" className="cfg-secondary-btn" onClick={() => setDraft(null)} disabled={saving}>
              {t('skillsConfig.cancel')}
            </button>
            <button type="button" className="cfg-primary-btn" onClick={() => void save()} disabled={saving}>
              {saving ? t('skillsConfig.saving') : t('skillsConfig.save')}
            </button>
          </div>
        </div>
      )}

      {showSearch && (
        <input
          type="search"
          className="cfg-input cfg-search"
          placeholder={t('skillsConfig.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {skills.length === 0 && !draft && mdText === null ? (
        <div className="cfg-empty">{t('skillsConfig.empty')}</div>
      ) : filteredSkills.length === 0 && query ? (
        // The search hides every workspace skill — only render the empty
        // hint when the inherited section is also empty below.
        inheritedEnabled && filteredInherited.length > 0 ? null : (
          <div className="cfg-empty">{t('skillsConfig.noMatches', { query })}</div>
        )
      ) : (
        <ul className="cfg-list">
          {filteredSkills.map((skill) => (
            <li key={skill.path} className="cfg-list-item">
              <div className="cfg-list-main">
                <div className="cfg-list-title">
                  {skill.name}
                  {skill.source !== 'canvas' && <span className="cfg-tag">{skill.source}</span>}
                </div>
                <div className="cfg-list-desc">{skill.description}</div>
              </div>
              {skill.writable && (
                <div className="cfg-list-actions">
                  <button
                    type="button"
                    className="cfg-secondary-btn"
                    onClick={() =>
                      setDraft({
                        originalName: skill.name,
                        name: skill.name,
                        description: skill.description,
                        body: skill.body,
                      })
                    }
                  >
                    {t('skillsConfig.edit')}
                  </button>
                  <button type="button" className="cfg-danger-btn" onClick={() => void remove(skill.name)}>
                    {t('skillsConfig.delete')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {inheritedEnabled && inherited.length > 0 && (
        <div className="cfg-inherited">
          <div className="cfg-inherited-header">
            <span className="cfg-inherited-title">
              {t('skillsConfig.inheritedTitle', { count: inherited.length })}
            </span>
            <span className="cfg-inherited-manage">{t('skillsConfig.inheritedManage')}</span>
          </div>
          {filteredInherited.length === 0 ? (
            <div className="cfg-empty">{t('skillsConfig.noMatches', { query })}</div>
          ) : (
            <ul className="cfg-list cfg-list--scrollable">
              {filteredInherited.map((skill) => {
                const overridden = skills.some(
                  (s) => s.name.toLowerCase() === skill.name.toLowerCase(),
                );
                return (
                  <li
                    key={skill.path}
                    className={`cfg-list-item cfg-list-item--readonly${overridden ? ' cfg-list-item--shadowed' : ''}`}
                    title={t('skillsConfig.readonlyHint', { source: skill.source })}
                  >
                    <div className="cfg-list-main">
                      <div className="cfg-list-title">
                        {skill.name}
                        <span className="cfg-tag">{skill.source}</span>
                      </div>
                      <div className="cfg-list-desc">{skill.description}</div>
                    </div>
                    {overridden && (
                      <span className="cfg-shadow-warn" title={t('skillsConfig.inheritedOverridden')}>
                        ⚠ {t('skillsConfig.inheritedOverridden')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {dir && (
        <div className="cfg-dir-hint" title={dir}>
          {dir}
        </div>
      )}
    </div>
  );
};
