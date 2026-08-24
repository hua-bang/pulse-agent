import { SegmentedControl } from '../../components/ui';
import { useI18n } from '../../i18n';

export const SkillsLibraryTabs = ({ onNavigatePlugins }: { onNavigatePlugins: () => void }) => {
  const { t } = useI18n();
  return (
    <div className="skills-library__product-tabs-row">
      <SegmentedControl
        ariaPattern="tab"
        ariaLabel={t('pluginMarket.tabsLabel')}
        className="skills-library__product-tabs"
        value="skills"
        options={[
          { id: 'plugins', label: t('pluginMarket.pluginsTab') },
          { id: 'skills', label: t('pluginMarket.skillsTab') },
        ]}
        onChange={(value) => {
          if (value === 'plugins') onNavigatePlugins();
        }}
      />
    </div>
  );
};
