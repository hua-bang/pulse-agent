import { useI18n, type LanguageCode } from '../../../i18n';
import { SectionHeader, FieldRow } from '../../ui';
import './index.css';

export const LanguageSection = () => {
  const { language, languageOptions, setLanguage, t } = useI18n();

  return (
    <div className="language-section">
      <div className="language-section-body">
        <div className="language-section-card">
          <SectionHeader
            className="language-section-intro"
            title={t('settings.language.introTitle')}
            description={t('settings.language.introDescription')}
          />

          <FieldRow label={t('settings.language.current')}>
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
          </FieldRow>

          <div className="language-section-hint">{t('settings.language.persistedHint')}</div>
        </div>
      </div>
    </div>
  );
};
