import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromptPreset, PromptProfile, PromptProfileStatus } from '../../types';
import { useI18n, type I18nKey } from '../../i18n';

interface UsePromptProfileResult {
  profile?: PromptProfileStatus;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  save: (next: Partial<PromptProfile>) => Promise<void>;
  reset: () => Promise<void>;
}

const DEFAULT_PRESET: PromptPreset = 'balanced';

export function usePromptProfile(): UsePromptProfileResult {
  const [profile, setProfile] = useState<PromptProfileStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const api = window.canvasWorkspace?.promptProfile;
    if (!api) return;
    setLoading(true);
    const result = await api.get();
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? 'Failed to load prompt profile');
      return;
    }
    setError(undefined);
    setProfile(result.profile);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (next: Partial<PromptProfile>) => {
    const result = await window.canvasWorkspace.promptProfile.save(next);
    if (!result.ok) {
      setError(result.error ?? 'Failed to save prompt profile');
      return;
    }
    setError(undefined);
    setProfile(result.profile);
  }, []);

  const reset = useCallback(async () => {
    const result = await window.canvasWorkspace.promptProfile.reset();
    if (!result.ok) {
      setError(result.error ?? 'Failed to reset prompt profile');
      return;
    }
    setError(undefined);
    setProfile(result.profile);
  }, []);

  return { profile, loading, error, refresh, save, reset };
}

interface PresetMeta {
  id: PromptPreset;
  titleKey: I18nKey;
  subtitleKey: I18nKey;
  descriptionKey: I18nKey;
}

const PRESETS: PresetMeta[] = [
  {
    id: 'concise',
    titleKey: 'prompt.concise.title',
    subtitleKey: 'prompt.concise.subtitle',
    descriptionKey: 'prompt.concise.description',
  },
  {
    id: 'balanced',
    titleKey: 'prompt.balanced.title',
    subtitleKey: 'prompt.balanced.subtitle',
    descriptionKey: 'prompt.balanced.description',
  },
  {
    id: 'detailed',
    titleKey: 'prompt.detailed.title',
    subtitleKey: 'prompt.detailed.subtitle',
    descriptionKey: 'prompt.detailed.description',
  },
];

interface ReplyStyleSectionProps {
  profile?: PromptProfileStatus;
  error?: string;
  /** Closes the surrounding Settings drawer (footer Close button). */
  onClose: () => void;
  onSave: (next: Partial<PromptProfile>) => Promise<void>;
  onReset: () => Promise<void>;
}

const MAX_CUSTOM_PROMPT_LENGTH = 4000;

export const ReplyStyleSection = ({
  profile,
  error,
  onClose,
  onSave,
  onReset,
}: ReplyStyleSectionProps) => {
  const { t } = useI18n();
  const [preset, setPreset] = useState<PromptPreset>(DEFAULT_PRESET);
  const [customPrompt, setCustomPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [savedHint, setSavedHint] = useState(false);

  // Initialize the draft from the loaded profile once. Section unmounts
  // on switch-away, so cancel = back to saved is preserved automatically.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || !profile) return;
    initializedRef.current = true;
    setPreset(profile.preset);
    setCustomPrompt(profile.customPrompt);
  }, [profile]);

  const dirty =
    profile != null && (preset !== profile.preset || customPrompt.trim() !== profile.customPrompt.trim());

  const save = useCallback(async () => {
    setSaving(true);
    setLocalError(undefined);
    try {
      await onSave({ preset, customPrompt });
      setSavedHint(true);
      window.setTimeout(() => setSavedHint(false), 1800);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [customPrompt, onSave, preset]);

  const reset = useCallback(async () => {
    setSaving(true);
    setLocalError(undefined);
    try {
      await onReset();
      setPreset(DEFAULT_PRESET);
      setCustomPrompt('');
      setSavedHint(true);
      window.setTimeout(() => setSavedHint(false), 1800);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [onReset]);

  return (
    <>
      <div className="chat-prompt-settings-body">
        <div className="chat-model-settings-card chat-model-settings-card--intro">
          <div>
            <strong>{t('prompt.introTitle')}</strong>
            <p>{t('prompt.introDescription')}</p>
          </div>
        </div>

        {(localError || error) && (
          <div className="chat-model-settings-error">{localError || error}</div>
        )}

        <div className="chat-model-field">
          <span>{t('prompt.preset')}</span>
          <div className="chat-prompt-preset-grid" role="radiogroup" aria-label={t('prompt.presetAria')}>
            {PRESETS.map(item => {
              const active = preset === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`chat-model-protocol-option chat-prompt-preset-option${active ? ' chat-model-protocol-option--active' : ''}`}
                  onClick={() => setPreset(item.id)}
                >
                  <span className="chat-model-protocol-title">{t(item.titleKey)}</span>
                  <span className="chat-model-protocol-sub">{t(item.subtitleKey)}</span>
                  <span className="chat-prompt-preset-desc">{t(item.descriptionKey)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="chat-model-field chat-prompt-custom-field">
          <span>{t('prompt.customPrompt')}</span>
          <textarea
            className="chat-prompt-custom-textarea"
            placeholder={t('prompt.customPlaceholder')}
            value={customPrompt}
            maxLength={MAX_CUSTOM_PROMPT_LENGTH}
            rows={6}
            onChange={event => setCustomPrompt(event.target.value)}
          />
          <span className="chat-model-field-hint">
            {t('prompt.customHint', { count: customPrompt.trim().length, max: MAX_CUSTOM_PROMPT_LENGTH })}
          </span>
        </label>
      </div>

      <div className="chat-model-settings-footer">
        <span>{profile?.path}</span>
        <button type="button" className="chat-model-secondary-btn" onClick={() => void reset()} disabled={saving}>
          {t('prompt.resetDefault')}
        </button>
        <button type="button" className="chat-model-secondary-btn" onClick={onClose} disabled={saving}>
          {t('prompt.close')}
        </button>
        <button
          type="button"
          className="chat-model-primary-btn"
          onClick={() => void save()}
          disabled={saving || !dirty}
        >
          {saving ? t('prompt.saving') : savedHint ? t('prompt.saved') : t('prompt.save')}
        </button>
      </div>
    </>
  );
};
