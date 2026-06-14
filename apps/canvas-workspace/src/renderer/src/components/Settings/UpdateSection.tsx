import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UpdateCheckResult, UpdateManifestSummary } from '../../types';
import { CheckIcon, ImportIcon, RefreshIcon, SpinnerIcon } from '../icons';
import { useI18n } from '../../i18n';
import './UpdateSection.css';

type UpdateStatus =
  | { status: 'checking' }
  | { status: 'unavailable' }
  | { status: 'ready'; result: UpdateCheckResult }
  | { status: 'error'; message: string };

const resolveNotes = (notes: UpdateManifestSummary['notes'], language: string): string => {
  if (typeof notes === 'string') return notes.trim();
  if (!notes) return '';
  const localized = language === 'zh' ? notes.zh : notes.en;
  return (localized ?? notes.en ?? notes.zh ?? '').trim();
};

const formatReleaseDate = (value: string | undefined, language: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
};

export const UpdateSection = () => {
  const { language, t } = useI18n();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'checking' });

  const checkForUpdates = useCallback(async () => {
    const api = window.canvasWorkspace?.appInfo;
    if (!api) {
      setUpdateStatus({ status: 'unavailable' });
      return;
    }

    setUpdateStatus({ status: 'checking' });
    try {
      const result = await api.checkForUpdates();
      setUpdateStatus({ status: 'ready', result });
    } catch (err) {
      setUpdateStatus({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  const body = useMemo(() => {
    if (updateStatus.status === 'checking') {
      return (
        <div className="updates-section-status">
          <span className="updates-section-status-icon updates-section-status-icon--loading" aria-hidden="true">
            <SpinnerIcon size={16} />
          </span>
          <div className="updates-section-status-copy">
            <div className="updates-section-status-title">{t('settings.updates.checking')}</div>
          </div>
        </div>
      );
    }

    if (updateStatus.status === 'unavailable') {
      return (
        <div className="updates-section-status">
          <span className="updates-section-status-icon" aria-hidden="true">
            <RefreshIcon size={16} />
          </span>
          <div className="updates-section-status-copy">
            <div className="updates-section-status-title">{t('settings.updates.unavailable')}</div>
          </div>
        </div>
      );
    }

    if (updateStatus.status === 'error') {
      return (
        <div className="updates-section-status updates-section-status--error">
          <span className="updates-section-status-icon" aria-hidden="true">
            <RefreshIcon size={16} />
          </span>
          <div className="updates-section-status-copy">
            <div className="updates-section-status-title">{t('settings.updates.checkFailed')}</div>
            <div className="updates-section-status-desc">{updateStatus.message}</div>
          </div>
        </div>
      );
    }

    const { result } = updateStatus;
    if (!result.ok) {
      return (
        <div className="updates-section-status updates-section-status--error">
          <span className="updates-section-status-icon" aria-hidden="true">
            <RefreshIcon size={16} />
          </span>
          <div className="updates-section-status-copy">
            <div className="updates-section-status-title">{t('settings.updates.checkFailed')}</div>
            {result.currentVersion ? (
              <div className="updates-section-status-desc">
                {t('updateNotice.currentVersion', { version: result.currentVersion })}
              </div>
            ) : null}
            {result.error ? (
              <div className="updates-section-status-desc">{result.error}</div>
            ) : null}
          </div>
        </div>
      );
    }

    const latest = result.latest;
    const releaseDate = formatReleaseDate(latest.releasedAt, language);
    const notes = resolveNotes(latest.notes, language);
    const openDownload = () => {
      void window.canvasWorkspace?.shell.openExternal(latest.downloadUrl);
    };

    return (
      <div className={`updates-section-status${result.updateAvailable ? ' updates-section-status--available' : ''}`}>
        <span className="updates-section-status-icon" aria-hidden="true">
          {result.updateAvailable ? <ImportIcon size={16} /> : <CheckIcon size={16} />}
        </span>
        <div className="updates-section-status-copy">
          <div className="updates-section-status-title">
            {result.updateAvailable
              ? t('updateNotice.title', { version: latest.version })
              : t('settings.updates.upToDate')}
          </div>
          <div className="updates-section-version-grid">
            <span>{t('updateNotice.currentVersion', { version: result.currentVersion })}</span>
            <span>{t('settings.updates.latestVersion', { version: latest.version })}</span>
            {releaseDate ? <span>{t('settings.updates.releasedAt', { date: releaseDate })}</span> : null}
          </div>
          {result.updateAvailable ? (
            <div className="updates-section-status-desc">
              {notes || t('settings.updates.availableDescription')}
            </div>
          ) : null}
        </div>
        {result.updateAvailable ? (
          <button type="button" className="updates-section-primary-btn" onClick={openDownload}>
            <ImportIcon size={14} />
            <span>{t('updateNotice.download')}</span>
          </button>
        ) : null}
      </div>
    );
  }, [language, t, updateStatus]);

  return (
    <div className="updates-section">
      <div className="updates-section-body">
        <div className="updates-section-card">
          <div className="updates-section-heading">
            <div className="updates-section-intro">
              <div className="updates-section-title">{t('settings.updates.introTitle')}</div>
              <div className="updates-section-desc">{t('settings.updates.introDescription')}</div>
            </div>
            <button
              type="button"
              className="updates-section-secondary-btn"
              onClick={() => void checkForUpdates()}
              disabled={updateStatus.status === 'checking'}
            >
              <RefreshIcon size={14} />
              <span>{t('settings.updates.checkAgain')}</span>
            </button>
          </div>
          {body}
        </div>
      </div>
    </div>
  );
};
