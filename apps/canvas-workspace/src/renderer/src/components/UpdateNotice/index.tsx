import { useEffect, useState } from 'react';
import { CloseIcon, ImportIcon } from '../icons';
import { useI18n } from '../../i18n';
import type { UpdateCheckResult } from '../../types';
import './index.css';

const DISMISSED_VERSION_KEY = 'pulse-canvas.dismissed-update-version';

type AvailableUpdate = Extract<UpdateCheckResult, { ok: true }> & {
  updateAvailable: true;
};

export const UpdateNotice = () => {
  const { t } = useI18n();
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);

  useEffect(() => {
    let canceled = false;

    const check = async () => {
      const api = window.canvasWorkspace?.appInfo;
      if (!api) return;

      const result = await api.checkForUpdates();
      if (canceled || !result.ok || !result.updateAvailable) return;

      const dismissedVersion = window.localStorage.getItem(DISMISSED_VERSION_KEY);
      if (dismissedVersion === result.latest.version) return;

      setUpdate(result as AvailableUpdate);
    };

    void check();
    return () => {
      canceled = true;
    };
  }, []);

  if (!update) return null;

  const latest = update.latest;
  const openDownload = () => {
    void window.canvasWorkspace?.shell.openExternal(latest.downloadUrl);
  };
  const dismiss = () => {
    window.localStorage.setItem(DISMISSED_VERSION_KEY, latest.version);
    setUpdate(null);
  };

  return (
    <aside className="update-notice" aria-label={t('updateNotice.ariaLabel')}>
      <div className="update-notice__main">
        <span className="update-notice__icon" aria-hidden="true">
          <ImportIcon size={16} />
        </span>
        <div className="update-notice__copy">
          <div className="update-notice__title">
            {t('updateNotice.title', { version: latest.version })}
          </div>
          <div className="update-notice__meta">
            {t('updateNotice.currentVersion', { version: update.currentVersion })}
          </div>
        </div>
      </div>
      <button type="button" className="update-notice__download" onClick={openDownload}>
        <ImportIcon size={14} />
        <span>{t('updateNotice.download')}</span>
      </button>
      <button
        type="button"
        className="update-notice__close"
        aria-label={t('updateNotice.dismiss')}
        title={t('updateNotice.dismiss')}
        onClick={dismiss}
      >
        <CloseIcon size={14} />
      </button>
    </aside>
  );
};
