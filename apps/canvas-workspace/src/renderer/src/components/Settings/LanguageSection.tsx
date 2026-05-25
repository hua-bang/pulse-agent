import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SupportedLocale } from '../../../../shared/locales';
import { useAppShell } from '../AppShellProvider';
import { useLocale } from '../../i18n/useLocale';
import './LanguageSection.css';

interface LanguageSectionProps {
  onClose: () => void;
}

export const LanguageSection = ({ onClose }: LanguageSectionProps) => {
  const { t } = useTranslation();
  const { locale, setLocale, supported } = useLocale();
  const { notify } = useAppShell();
  const [pending, setPending] = useState<SupportedLocale | null>(null);

  const handleSelect = useCallback(
    async (next: SupportedLocale) => {
      if (next === locale || pending) return;
      setPending(next);
      const result = await setLocale(next);
      setPending(null);
      if (!result.ok) {
        notify({
          tone: 'error',
          title: t('settings.language.saveErrorToast.title'),
          description: result.error ?? 'Unknown error',
        });
        return;
      }
      notify({
        tone: 'success',
        title: t('settings.language.savedToast.title'),
      });
    },
    [locale, pending, setLocale, notify, t],
  );

  return (
    <div className="language-section">
      <div className="language-section-body">
        <p className="language-section-intro">{t('settings.language.intro')}</p>
        <ul className="language-section-list" aria-label={t('settings.sections.language.title')}>
          {supported.map((code) => {
            const selected = code === locale;
            const busy = pending === code;
            return (
              <li key={code}>
                <button
                  type="button"
                  className={`language-section-item${selected ? ' language-section-item--active' : ''}`}
                  aria-current={selected ? 'true' : undefined}
                  disabled={busy}
                  onClick={() => void handleSelect(code)}
                >
                  <span className="language-section-item-label">
                    {t(`settings.language.options.${code}`)}
                  </span>
                  <span className="language-section-item-meta">{code}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="language-section-hint">{t('settings.language.hint')}</p>
      </div>
      <div className="language-section-footer">
        <button
          type="button"
          className="language-section-secondary-btn"
          onClick={onClose}
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
};
