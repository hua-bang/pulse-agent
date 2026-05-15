import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PromptPreset, PromptProfile, PromptProfileStatus } from '../../types';

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
  title: string;
  subtitle: string;
  description: string;
}

const PRESETS: PresetMeta[] = [
  {
    id: 'concise',
    title: '简洁 (Concise)',
    subtitle: 'Short answers, conclusion-first',
    description: '助手优先给结论，1-4 句搞定，不展开过程。工具调用结果只总结关键差异。',
  },
  {
    id: 'balanced',
    title: '平衡 (Balanced)',
    subtitle: '默认 — Default',
    description: '先给短结论，再补必要解释。该列表用列表，该展开才展开。',
  },
  {
    id: 'detailed',
    title: '详细 (Detailed)',
    subtitle: 'Steps, risks, alternatives',
    description: '答得更细：步骤、风险、可选方案都摆出来，但不重复啰嗦。',
  },
];

interface PromptSettingsDrawerProps {
  open: boolean;
  profile?: PromptProfileStatus;
  error?: string;
  onClose: () => void;
  onSave: (next: Partial<PromptProfile>) => Promise<void>;
  onReset: () => Promise<void>;
}

const MAX_CUSTOM_PROMPT_LENGTH = 4000;

export const PromptSettingsDrawer = ({
  open,
  profile,
  error,
  onClose,
  onSave,
  onReset,
}: PromptSettingsDrawerProps) => {
  const [preset, setPreset] = useState<PromptPreset>(DEFAULT_PRESET);
  const [customPrompt, setCustomPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [savedHint, setSavedHint] = useState(false);

  // Reset the draft each time the drawer opens so cancel = "go back to saved".
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      setLocalError(undefined);
      setSavedHint(false);
      return;
    }
    if (initializedRef.current || !profile) return;
    initializedRef.current = true;
    setPreset(profile.preset);
    setCustomPrompt(profile.customPrompt);
  }, [open, profile]);

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

  if (!open) return null;

  return createPortal(
    <div className="chat-model-settings-backdrop" onMouseDown={onClose}>
      <aside
        className="chat-model-settings chat-prompt-settings"
        onMouseDown={event => event.stopPropagation()}
        aria-label="AI reply style settings"
      >
        <div className="chat-model-settings-header">
          <div>
            <div className="chat-model-settings-kicker">AI Settings</div>
            <h2>Reply Style &amp; Custom Prompt</h2>
          </div>
          <button
            type="button"
            className="chat-model-settings-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="chat-prompt-settings-body">
          <div className="chat-model-settings-card chat-model-settings-card--intro">
            <div>
              <strong>调整助手的回复风格</strong>
              <p>
                选择一个预设来控制助手回复的详略，并可以再写一段自定义提示词补充偏好（例如"用中文"、"先列要点再展开"）。
                自定义提示词不会覆盖安全规则、工具使用规则和确认规则。
              </p>
            </div>
          </div>

          {(localError || error) && (
            <div className="chat-model-settings-error">{localError || error}</div>
          )}

          <div className="chat-model-field">
            <span>预设 / Preset</span>
            <div className="chat-prompt-preset-grid" role="radiogroup" aria-label="Reply style preset">
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
                    <span className="chat-model-protocol-title">{item.title}</span>
                    <span className="chat-model-protocol-sub">{item.subtitle}</span>
                    <span className="chat-prompt-preset-desc">{item.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="chat-model-field chat-prompt-custom-field">
            <span>自定义提示词 / Custom Prompt</span>
            <textarea
              className="chat-prompt-custom-textarea"
              placeholder="例如：默认使用中文。代码块请加语言标签。不要在结尾问 &quot;还需要帮忙吗？&quot;"
              value={customPrompt}
              maxLength={MAX_CUSTOM_PROMPT_LENGTH}
              rows={6}
              onChange={event => setCustomPrompt(event.target.value)}
            />
            <span className="chat-model-field-hint">
              {customPrompt.trim().length}/{MAX_CUSTOM_PROMPT_LENGTH} 字符 · 不会覆盖工具/安全/确认规则
            </span>
          </label>
        </div>

        <div className="chat-model-settings-footer">
          <span>{profile?.path}</span>
          <button type="button" className="chat-model-secondary-btn" onClick={() => void reset()} disabled={saving}>
            恢复默认
          </button>
          <button type="button" className="chat-model-secondary-btn" onClick={onClose} disabled={saving}>
            关闭
          </button>
          <button
            type="button"
            className="chat-model-primary-btn"
            onClick={() => void save()}
            disabled={saving || !dirty}
          >
            {saving ? '保存中…' : savedHint ? '已保存 ✓' : '保存'}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
};
