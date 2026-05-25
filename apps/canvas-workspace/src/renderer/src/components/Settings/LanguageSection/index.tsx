import { useI18n, type LanguageCode } from '../../../i18n';
import './index.css';

export const LanguageSection = () => {
  const { language, languageOptions, setLanguage, t } = useI18n();

  return (
    <div className="language-section">
      <div className="language-section-body">
        <div className="language-section-card">
          <div className="language-section-intro">
            <div className="language-section-title">{t('settings.language.introTitle')}</div>
            <div className="language-section-desc">{t('settings.language.introDescription')}</div>
          </div>

          <div className="language-section-field">
            <span>{t('settings.language.current')}</span>
            <div className="language-section-options" role="radiogroup" aria-label={t('settings.language.current')}>
              {languageOptions.map((option) => {
                const active = option.code === language;
                return (
                  <button
                    key={option.code}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`language-section-option${active ? ' language-section-option--active' : ''}`}
                    onClick={() => setLanguage(option.code as LanguageCode)}
                  >
                    <span className="language-section-option-label">{option.nativeLabel}</span>
                    <span className="language-section-option-sub">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="language-section-hint">{t('settings.language.persistedHint')}</div>
        </div>
      </div>
    </div>
  );
};
