/**
 * SkillsManager — CRUD UI for user-defined skills at a given scope.
 * Reused by the global Settings panel and the per-workspace settings drawer.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CanvasConfigScope, CanvasSkillEntry } from '../../types';
import { useI18n } from '../../i18n';
import { useAppShell } from '../AppShellProvider';
import './settings-config.css';

interface Props {
  scope: CanvasConfigScope;
}

interface Draft {
  originalName?: string;
  name: string;
  description: string;
  body: string;
}

const EMPTY_DRAFT: Draft = { name: '', description: '', body: '' };

export const SkillsManager = ({ scope }: Props) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const [skills, setSkills] = useState<CanvasSkillEntry[]>([]);
  const [dir, setDir] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const scopeKey = scope.level === 'workspace' ? scope.workspaceId : 'global';

  const load = useCallback(async () => {
    const res = await window.canvasWorkspace.canvasSkills.list(scope);
    if (res.ok && res.status) {
      setSkills(res.status.skills);
      setDir(res.status.dir);
    } else {
      notify({ tone: 'error', title: t('skillsConfig.loadFailed'), description: res.error ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, t]);

  useEffect(() => {
    setDraft(null);
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

  return (
    <div className="cfg-manager">
      <div className="cfg-toolbar">
        <button
          type="button"
          className="cfg-secondary-btn"
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
          disabled={draft !== null}
        >
          + {t('skillsConfig.add')}
        </button>
      </div>

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

      {skills.length === 0 && !draft ? (
        <div className="cfg-empty">{t('skillsConfig.empty')}</div>
      ) : (
        <ul className="cfg-list">
          {skills.map((skill) => (
            <li key={skill.path} className="cfg-list-item">
              <div className="cfg-list-main">
                <div className="cfg-list-title">{skill.name}</div>
                <div className="cfg-list-desc">{skill.description}</div>
              </div>
              <div className="cfg-list-actions">
                <button
                  type="button"
                  className="cfg-secondary-btn"
                  onClick={() =>
                    setDraft({ originalName: skill.name, name: skill.name, description: skill.description, body: skill.body })
                  }
                >
                  {t('skillsConfig.edit')}
                </button>
                <button type="button" className="cfg-danger-btn" onClick={() => void remove(skill.name)}>
                  {t('skillsConfig.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dir && (
        <div className="cfg-dir-hint" title={dir}>
          {dir}
        </div>
      )}
    </div>
  );
};
