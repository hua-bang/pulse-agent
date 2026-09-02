import { useCallback, useEffect, useState } from 'react';
import type { AgentRoleDefinition } from '../../types';
import {
  AGENT_ROLE_COLORS,
  AGENT_ROLE_NAME_MAX_LENGTH,
  AGENT_ROLE_PROMPT_MAX_LENGTH,
  type AgentRoleExternalFamily,
  type AgentRoleSaveInput,
} from '../../../../shared/agent-roles';
import { useI18n } from '../../i18n';
import { Button, SegmentedControl, SwatchRow, TextField } from '../ui';
import { invalidateRoleMentionItems } from './hooks/roleMentionItems';
import { roleColorSoft } from '../../utils/roleColors';
import './ModelSettings.css';
import './RolesSettings.css';

const familyLabel = (family: AgentRoleExternalFamily): string =>
  family === 'claude-code' ? 'Claude Code' : 'Codex';

interface UseAgentRolesResult {
  roles: AgentRoleDefinition[];
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  save: (input: AgentRoleSaveInput) => Promise<AgentRoleDefinition | null>;
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

  const save = useCallback(async (input: AgentRoleSaveInput) => {
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
type Draft = {
  id?: string;
  name: string;
  color: string;
  prompt: string;
  driver: 'persona' | AgentRoleExternalFamily;
  cwd: string;
};

const emptyDraft = (roles: AgentRoleDefinition[]): Draft => ({
  name: '',
  color: AGENT_ROLE_COLORS.find(color => !roles.some(role => role.color === color)) ?? AGENT_ROLE_COLORS[0],
  prompt: '',
  driver: 'persona',
  cwd: '',
});

const draftOf = (role: AgentRoleDefinition): Draft => ({
  id: role.id,
  name: role.name,
  color: role.color,
  prompt: role.prompt,
  driver: role.external?.family ?? 'persona',
  cwd: role.external?.cwd ?? '',
});

export const RolesSection = ({ onClose }: RolesSectionProps) => {
  const { t } = useI18n();
  const { roles, error, save, remove } = useAgentRoles();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState(false);

  // Agent@agent handoff switch (library-level; null until loaded). Saved
  // optimistically — the next turn reads it fresh main-side.
  const [handoffEnabled, setHandoffEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.canvasWorkspace.agentRoles.getSettings().then(result => {
      if (!cancelled && result.ok) setHandoffEnabled(result.settings.allowRoleHandoff);
    });
    return () => { cancelled = true; };
  }, []);
  const handleHandoffChange = useCallback((id: string) => {
    const next = id === 'on';
    setHandoffEnabled(next);
    void window.canvasWorkspace.agentRoles.saveSettings({ allowRoleHandoff: next });
  }, []);

  // Bind the editor to the first role once loaded (or the new-role form when
  // the library is empty). A selection or a DIRTY new-role draft survives
  // refreshes; a pristine new-role form yields to the first loaded role so
  // opening the section never lands on a blank editor.
  useEffect(() => {
    setDraft(prev => {
      if (prev?.id && roles.some(role => role.id === prev.id)) return prev;
      if (prev && !prev.id && (prev.name.trim() || prev.prompt.trim() || prev.cwd.trim())) return prev;
      const first = roles[0];
      return first ? draftOf(first) : emptyDraft(roles);
    });
  }, [roles]);

  const selectRole = useCallback((role: AgentRoleDefinition) => {
    setDraft(draftOf(role));
  }, []);

  // Health probe per driver family, cached for the drawer's lifetime.
  const [probe, setProbe] = useState<Record<string, { status: 'checking' | 'ok' | 'fail'; detail: string }>>({});
  const draftFamily = draft && draft.driver !== 'persona' ? draft.driver : null;
  useEffect(() => {
    if (!draftFamily || probe[draftFamily]) return;
    setProbe(prev => ({ ...prev, [draftFamily]: { status: 'checking', detail: '' } }));
    void window.canvasWorkspace.agentRoles.externalProbe(draftFamily).then(result => {
      setProbe(prev => ({
        ...prev,
        [draftFamily]: result.ok
          ? { status: 'ok', detail: result.version }
          : { status: 'fail', detail: result.error },
      }));
    });
  }, [draftFamily, probe]);

  const startNewRole = useCallback(() => {
    setDraft(emptyDraft(roles));
  }, [roles]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    const saved = await save({
      id: draft.id,
      name: draft.name,
      color: draft.color,
      prompt: draft.prompt,
      external: draft.driver === 'persona'
        ? null
        : { family: draft.driver, ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}) },
    });
    setSaving(false);
    if (saved) {
      setDraft(draftOf(saved));
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

  // External roles bring their own instructions, so the persona prompt is
  // optional for them; a persona role IS its prompt.
  const canSave = !!draft && !!draft.name.trim() && !saving
    && (draft.driver !== 'persona' || !!draft.prompt.trim());

  return (
    <>
      <div className="chat-prompt-settings-body">
        <div className="chat-model-settings-card chat-model-settings-card--intro">
          <div>
            <strong>{t('roles.introTitle')}</strong>
            <p>{t('roles.introDescription')}</p>
          </div>
        </div>

        <div className="chat-model-settings-card chat-model-settings-card--intro chat-roles-handoff-card">
          <div>
            <strong>{t('roles.handoff')}</strong>
            <p>{t('roles.handoffHint')}</p>
          </div>
          {handoffEnabled !== null && (
            <SegmentedControl
              options={[
                { id: 'off', label: t('roles.handoffOff') },
                { id: 'on', label: t('roles.handoffOn') },
              ]}
              value={handoffEnabled ? 'on' : 'off'}
              onChange={handleHandoffChange}
              ariaLabel={t('roles.handoff')}
            />
          )}
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
                <span className="chat-roles-row-name">
                  {role.name}
                  {role.external && (
                    <span className="chat-roles-row-driver">{familyLabel(role.external.family)}</span>
                  )}
                </span>
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
            <div className="chat-model-field">
              <span>{t('roles.driver')}</span>
              <SegmentedControl
                options={[
                  { id: 'persona', label: t('roles.driverPersona') },
                  { id: 'claude-code', label: 'Claude Code' },
                  { id: 'codex', label: 'Codex' },
                ]}
                value={draft.driver}
                onChange={id => setDraft({ ...draft, driver: id as Draft['driver'] })}
                ariaLabel={t('roles.driver')}
              />
            </div>
            {draft.driver !== 'persona' && (
              <>
                <TextField
                  label={t('roles.driverCwd')}
                  placeholder={t('roles.driverCwdPlaceholder')}
                  value={draft.cwd}
                  onChange={event => setDraft({ ...draft, cwd: event.target.value })}
                />
                <p className="chat-roles-driver-status" role="status">
                  {probe[draft.driver]?.status === 'checking' && t('roles.driverProbing')}
                  {probe[draft.driver]?.status === 'ok' && `✓ ${probe[draft.driver].detail}`}
                  {probe[draft.driver]?.status === 'fail' && `✕ ${probe[draft.driver].detail}`}
                </p>
                <p className="chat-roles-driver-hint">{t('roles.driverHint')}</p>
              </>
            )}
            <TextField
              multiline
              label={draft.driver === 'persona' ? t('roles.prompt') : t('roles.promptOptional')}
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
