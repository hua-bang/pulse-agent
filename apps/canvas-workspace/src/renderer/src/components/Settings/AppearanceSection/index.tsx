import { useState } from 'react';
import { useI18n } from '../../../i18n';
import { FieldRow, SectionHeader, SegmentedControl } from '../../ui';
import { applyTheme, getStoredTheme, type CanvasTheme } from '../../../theme';
import './index.css';

export const AppearanceSection = () => {
  const { t } = useI18n();
  const [theme, setTheme] = useState<CanvasTheme>(() => getStoredTheme());

  const handleThemeChange = (id: string) => {
    const next = id as CanvasTheme;
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div className="appearance-panel">
      <div className="appearance-scroll">
        <div className="appearance-card">
          <SectionHeader
            className="appearance-intro"
            title={t('settings.appearance.introTitle')}
            description={t('settings.appearance.introDescription')}
          />
          <FieldRow label={t('settings.appearance.theme')}>
            <SegmentedControl
              ariaLabel={t('settings.appearance.theme')}
              options={[
                { id: 'classic', label: t('settings.appearance.themeClassic') },
                { id: 'spatial', label: t('settings.appearance.themeSpatial') },
              ]}
              value={theme}
              onChange={handleThemeChange}
            />
          </FieldRow>
          <div className="appearance-hint">{t('settings.appearance.persistedHint')}</div>
        </div>
      </div>
    </div>
  );
};
