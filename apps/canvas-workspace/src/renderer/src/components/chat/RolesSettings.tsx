import { useCallback, useEffect, useState } from 'react';
import type { AgentRoleDefinition } from '../../types';
import { AGENT_ROLE_COLORS, AGENT_ROLE_NAME_MAX_LENGTH, AGENT_ROLE_PROMPT_MAX_LENGTH } from '../../../../shared/agent-roles';
import { useI18n } from '../../i18n';
import { Button, SwatchRow, TextField } from '../ui';
import { invalidateRoleMentionItems } from './hooks/roleMentionItems';
import { roleColorSoft } from './utils/roleColors';
import './ModelSettings.css';
import './RolesSettings.css';

interface UseAgentRolesResult {
  roles: AgentRoleDefinition[];
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  save: (input: { id?: string; name: string; color?: string; prompt: string }) => Promise<AgentRoleDefinition | null>;
  remove: (id: string) => Promise<boolean>;
}

export function useAgentRoles(): UseAgentRolesResult {
  const [roles, setRoles] = useState<AgentRoleDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const api = window.canvasWorkspace?.agentRoles;
    if (!api) return;
    setLoading(true);
    const result = await api.list();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(undefined);
    setRoles(result.roles);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (input: { id?: string; name: string; color?: string; prompt: string }) => {
    const result = await window.canvasWorkspace.agentRoles.save(input);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    setError(undefined);
    // Repaint popup entries + transcript chip accents without waiting out the TTL.
    void invalidateRoleMentionItems();
    await refresh();
    return result.role;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    const result = await window.canvasWorkspace.agentRoles.remove(id);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setError(undefined);
    void invalidateRoleMentionItems();
    await refresh();
    return true;
  }, [refresh]);

  return { roles, loading, error, refresh, save, remove };
}

interface RolesSectionProps {
  /** Closes the surrounding Settings drawer (footer Close button). */
  onClose: () => void;
}

/** `undefined` selection = composing a brand-new role. */
type Draft = { id?: string; name: string; color: string; prompt: string };

const emptyDraft = (roles: AgentRoleDefinition[]): Draft => ({
  name: '',
  color: AGENT_ROLE_COLORS.find(color => !roles.some(role => role.color === color)) ?? AGENT_ROLE_COLORS[0],
  prompt: '',
});

export const RolesSection = ({ onClose }: RolesSectionProps) => {
  const { t } = useI18n();
  const { roles, error, save, remove } = useAgentRoles();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);

  // Bind the editor to the first role once loaded (or the new-role form when
  // the library is empty). A selection or a DIRTY new-role draft survives
  // refreshes; a pristine new-role form yields to the first loaded role so
  // opening the section never lands on a blank editor.
  useEffect(() => {
    setDraft(prev => {
      if (prev?.id && roles.some(role => role.id === prev.id)) return prev;
      if (prev && !prev.id && (prev.name.trim() || prev.prompt.trim())) return prev;
      const first = roles[0];
      return first
        ? { id: first.id, name: first.name, color: first.color, prompt: first.prompt }
        : emptyDraft(roles);
    });
  }, [roles]);

  const selectRole = useCallback((role: AgentRoleDefinition) => {
    setDraft({ id: role.id, name: role.name, color: role.color, prompt: role.prompt });
  }, []);

  const startNewRole = useCallback(() => {
    setDraft(emptyDraft(roles));
  }, [roles]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    const saved = await save({ id: draft.id, name: draft.name, color: draft.color, prompt: draft.prompt });
    setSaving(false);
    if (saved) {
      setDraft({ id: saved.id, name: saved.name, color: saved.color, prompt: saved.prompt });
      setSavedHint(true);
      window.setTimeout(() => setSavedHint(false), 1800);
    }
  }, [draft, save]);

  const handleDelete = useCallback(async () => {
    if (!draft?.id) return;
    setSaving(true);
    await remove(draft.id);
    setSaving(false);
    setDraft(null);
  }, [draft, remove]);

  const canSave = !!draft && !!draft.name.trim() && !!draft.prompt.trim() && !saving;

  return (
    <>
      <div className="chat-prompt-settings-body">
        <div className="chat-model-settings-card chat-model-settings-card--intro">
          <div>
            <strong>{t('roles.introTitle')}</strong>
            <p>{t('roles.introDescription')}</p>
          </div>
        </div>

        {error && <div className="chat-model-settings-error">{error}</div>}

        <div className="chat-roles-list">
          {roles.map(role => (
            <button
              key={role.id}
              type="button"
              className={`chat-roles-row${draft?.id === role.id ? ' chat-roles-row--selected' : ''}`}
              onClick={() => selectRole(role)}
            >
              <span
                className="chat-roles-row-avatar"
                style={{ color: role.color, background: roleColorSoft(role.color) }}
              >
                {role.name.slice(0, 1)}
              </span>
              <span className="chat-roles-row-meta">
                <span className="chat-roles-row-name">{role.name}</span>
                <span className="chat-roles-row-preview">{role.prompt}</span>
              </span>
            </button>
          ))}
          {roles.length === 0 && (
            <div className="chat-roles-empty">{t('roles.empty')}</div>
          )}
          <Button size="sm" className="chat-roles-add-btn" onClick={startNewRole}>
            ＋ {t('roles.addRole')}
          </Button>
        </div>

        {draft && (
          <div className="chat-roles-editor">
            <TextField
              label={t('roles.name')}
              placeholder={t('roles.namePlaceholder')}
              value={draft.name}
              maxLength={AGENT_ROLE_NAME_MAX_LENGTH}
              onChange={event => setDraft({ ...draft, name: event.target.value })}
            />
            <div className="chat-model-field">
              <span>{t('roles.color')}</span>
              <SwatchRow
                options={AGENT_ROLE_COLORS.map(color => ({ value: color, label: color }))}
                value={draft.color}
                onChange={color => setDraft({ ...draft, color })}
                ariaPattern="toggle"
                ariaLabel={t('roles.color')}
              />
            </div>
            <TextField
              multiline
              label={t('roles.prompt')}
              hint={t('prompt.customHint', { count: draft.prompt.trim().length, max: AGENT_ROLE_PROMPT_MAX_LENGTH })}
              className="chat-prompt-custom-textarea"
              placeholder={t('roles.promptPlaceholder')}
              value={draft.prompt}
              maxLength={AGENT_ROLE_PROMPT_MAX_LENGTH}
              rows={5}
              onChange={event => setDraft({ ...draft, prompt: event.target.value })}
            />
          </div>
        )}
      </div>

      <div className="chat-model-settings-footer">
        <span />
        {draft?.id && (
          <Button variant="danger" size="sm" onClick={() => void handleDelete()} disabled={saving}>
            {t('roles.delete')}
          </Button>
        )}
        <Button size="sm" onClick={onClose} disabled={saving}>
          {t('prompt.close')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={!canSave}>
          {saving ? t('prompt.saving') : savedHint ? t('prompt.saved') : t('prompt.save')}
        </Button>
      </div>
    </>
  );
};
