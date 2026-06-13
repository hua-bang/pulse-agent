import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BuiltInToolCredentialId,
  BuiltInToolCredentialStatus,
  BuiltInToolsConfigStatus,
} from '../../types';
import { useAppShell } from '../AppShellProvider';
import { useI18n } from '../../i18n';
import './BuiltInToolsSection.css';

interface BuiltInToolsSectionProps {
  onClose: () => void;
}

interface CredentialDraft {
  apiKey: string;
  baseUrl?: string;
}

type Drafts = Partial<Record<BuiltInToolCredentialId, CredentialDraft>>;

export const BuiltInToolsSection = ({ onClose }: BuiltInToolsSectionProps) => {
  const { notify } = useAppShell();
  const { t } = useI18n();
  const [status, setStatus] = useState<BuiltInToolsConfigStatus | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<BuiltInToolCredentialId | null>(null);
  const [clearingId, setClearingId] = useState<BuiltInToolCredentialId | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.canvasWorkspace.builtInTools.status();
      if (!result.ok || !result.status) {
        throw new Error(result.error ?? t('toolsConfig.loadFailed'));
      }
      setStatus(result.status);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const setDraftField = useCallback((
    id: BuiltInToolCredentialId,
    key: keyof CredentialDraft,
    value: string,
  ) => {
    setDrafts((current) => ({
      ...current,
      [id]: {
        apiKey: '',
        ...(current[id] ?? {}),
        [key]: value,
      },
    }));
  }, []);

  const save = useCallback(async (credential: BuiltInToolCredentialStatus) => {
    const draft = drafts[credential.id];
    const apiKey = draft?.apiKey.trim() ?? '';
    const storedBaseUrl = credential.baseUrlSource === 'stored' ? credential.baseUrl : '';
    const baseUrl = (draft?.baseUrl ?? storedBaseUrl).trim();
    const baseUrlChanged = baseUrl !== storedBaseUrl;

    if (!apiKey && !baseUrlChanged) {
      setError(t('toolsConfig.apiKeyOrBaseUrlRequired'));
      return;
    }

    setSavingId(credential.id);
    setError(null);
    try {
      const result = await window.canvasWorkspace.builtInTools.setCredential(credential.id, {
        apiKey: apiKey || undefined,
        baseUrl,
      });
      if (!result.ok || !result.status) {
        throw new Error(result.error ?? t('toolsConfig.saveFailed'));
      }
      setStatus(result.status);
      setDrafts((current) => ({ ...current, [credential.id]: { apiKey: '' } }));
      notify({
        tone: 'success',
        title: t('toolsConfig.savedTitle'),
        description: t('toolsConfig.savedDescription', { name: credential.name }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      notify({ tone: 'error', title: t('toolsConfig.saveFailed'), description: msg });
    } finally {
      setSavingId(null);
    }
  }, [drafts, notify, t]);

  const clear = useCallback(async (credential: BuiltInToolCredentialStatus) => {
    setClearingId(credential.id);
    setError(null);
    try {
      const result = await window.canvasWorkspace.builtInTools.clearCredential(credential.id);
      if (!result.ok || !result.status) {
        throw new Error(result.error ?? t('toolsConfig.clearFailed'));
      }
      setStatus(result.status);
      setDrafts((current) => ({ ...current, [credential.id]: { apiKey: '' } }));
      notify({
        tone: 'success',
        title: t('toolsConfig.clearedTitle'),
        description: t('toolsConfig.clearedDescription', { name: credential.name }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      notify({ tone: 'error', title: t('toolsConfig.clearFailed'), description: msg });
    } finally {
      setClearingId(null);
    }
  }, [notify, t]);

  const configuredCount = useMemo(
    () => status?.credentials.filter((credential) => credential.apiKeyPresent).length ?? 0,
    [status],
  );

  return (
    <div className="built-in-tools-section">
      <div className="built-in-tools-body">
        <div className="built-in-tools-summary">
          <div>
            <div className="built-in-tools-title">{t('toolsConfig.title')}</div>
            <div className="built-in-tools-description">
              {t('toolsConfig.description')}
            </div>
          </div>
          {status && (
            <div className="built-in-tools-count">
              {t('toolsConfig.configuredCount', {
                configured: configuredCount,
                total: status.credentials.length,
              })}
            </div>
          )}
        </div>

        {error && <div className="built-in-tools-error">{error}</div>}

        {loading && (
          <div className="built-in-tools-loading">{t('toolsConfig.loading')}</div>
        )}

        <div className="built-in-tools-list">
          {status?.credentials.map((credential) => {
            const draft = drafts[credential.id];
            const apiKeyDraft = draft?.apiKey ?? '';
            const storedBaseUrl = credential.baseUrlSource === 'stored' ? credential.baseUrl : '';
            const baseUrlDraft = draft?.baseUrl ?? storedBaseUrl;
            const hasStoredConfig = credential.source === 'stored' || credential.baseUrlSource === 'stored';

            return (
              <div key={credential.id} className="built-in-tool-card">
                <div className="built-in-tool-card-head">
                  <div>
                    <div className="built-in-tool-title-row">
                      <span className={`built-in-tool-status-dot built-in-tool-status-dot--${credential.source}`} />
                      <span className="built-in-tool-name">{credential.name}</span>
                    </div>
                    <div className="built-in-tool-description">{credential.description}</div>
                  </div>
                  <CredentialBadge credential={credential} />
                </div>

                <div className="built-in-tool-meta">
                  <div>
                    <span>{t('toolsConfig.currentBaseUrl')}</span>
                    <span>
                      <code>{credential.baseUrl}</code>
                      <span className="built-in-tool-meta-note">
                        {formatBaseUrlSource(credential, t)}
                      </span>
                    </span>
                  </div>
                  <div>
                    <span>{t('toolsConfig.toolsLabel')}</span>
                    <span>{credential.tools.join(', ')}</span>
                  </div>
                </div>

                <div className="built-in-tool-form">
                  <label className="built-in-tool-field">
                    <span>{t('toolsConfig.apiKey')}</span>
                    <input
                      type="password"
                      value={apiKeyDraft}
                      placeholder={
                        credential.apiKeyPresent
                          ? t('toolsConfig.keepSavedPlaceholder')
                          : t('toolsConfig.enterKeyPlaceholder')
                      }
                      onChange={(event) => setDraftField(credential.id, 'apiKey', event.target.value)}
                    />
                  </label>
                  <label className="built-in-tool-field">
                    <span>{t('toolsConfig.baseUrl')}</span>
                    <input
                      value={baseUrlDraft}
                      placeholder={credential.baseUrl}
                      onChange={(event) => setDraftField(credential.id, 'baseUrl', event.target.value)}
                    />
                  </label>
                  <div className="built-in-tool-actions">
                    {hasStoredConfig && (
                      <button
                        type="button"
                        className="built-in-tool-secondary-btn"
                        onClick={() => void clear(credential)}
                        disabled={clearingId === credential.id}
                      >
                        {clearingId === credential.id ? t('toolsConfig.clearing') : t('toolsConfig.clearStored')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="built-in-tool-primary-btn"
                      onClick={() => void save(credential)}
                      disabled={savingId === credential.id}
                    >
                      {savingId === credential.id ? t('toolsConfig.saving') : t('toolsConfig.saveKey')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="built-in-tools-footer">
        <button type="button" className="built-in-tool-secondary-btn" onClick={onClose}>
          {t('agent.close')}
        </button>
      </div>
    </div>
  );
};

function CredentialBadge({ credential }: { credential: BuiltInToolCredentialStatus }) {
  const { t } = useI18n();
  const label = credential.source === 'stored'
    ? t('toolsConfig.sourceStored')
    : credential.source === 'env'
      ? t('toolsConfig.sourceEnv')
      : t('toolsConfig.sourceMissing');
  const length = credential.apiKeyLength
    ? t('toolsConfig.keyLength', { length: credential.apiKeyLength })
    : '';

  return (
    <span className={`built-in-tool-badge built-in-tool-badge--${credential.source}`}>
      {label}{length ? ` · ${length}` : ''}
    </span>
  );
}

function formatBaseUrlSource(
  credential: BuiltInToolCredentialStatus,
  t: ReturnType<typeof useI18n>['t'],
) {
  const label = credential.baseUrlSource === 'stored'
    ? t('toolsConfig.sourceStored')
    : credential.baseUrlSource === 'env'
      ? t('toolsConfig.sourceEnv')
      : t('toolsConfig.sourceDefault');
  return ` · ${label}`;
}
