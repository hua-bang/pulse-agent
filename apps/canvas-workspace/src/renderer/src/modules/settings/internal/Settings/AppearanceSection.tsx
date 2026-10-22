/**
 * Appearance section of the global Settings page: light, dark, or follow the
 * OS. The preference lives in renderer localStorage (shared/theme.ts) and
 * applies immediately, like the language setting.
 */
import { useI18n } from '../../../../i18n';
import { SectionHeader, SegmentedControl } from '../../../../components/ui';
import { useThemePreference, type ThemePreference } from '../../../../shared/theme';
import { formatShortcutId } from '../../../../shortcuts/registry';
import './AppearanceSection.css';

export const AppearanceSection = () => {
  const { t } = useI18n();
  const [preference, setPreference] = useThemePreference();

  return (
    <div className="cfg-pane">
      <div className="appearance-settings">
        <SectionHeader
          title={t('settings.appearance.title')}
          description={t('settings.appearance.description', { shortcut: formatShortcutId('app.toggleTheme') })}
        />
        <SegmentedControl
          options={[
            { id: 'system', label: t('settings.appearance.system') },
            { id: 'light', label: t('settings.appearance.light') },
            { id: 'dark', label: t('settings.appearance.dark') },
          ]}
          value={preference}
          onChange={(id) => setPreference(id as ThemePreference)}
          ariaLabel={t('settings.appearance.title')}
        />
      </div>
    </div>
  );
};
