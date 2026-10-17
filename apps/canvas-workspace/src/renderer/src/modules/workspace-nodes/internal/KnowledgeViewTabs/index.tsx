import { SegmentedControl } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';

export type KnowledgeView = 'list' | 'graph';

interface Props {
  value: KnowledgeView;
  onChange: (view: KnowledgeView) => void;
}

/**
 * The one switch between the Knowledge list and graph. Both views sit
 * behind a single sidebar entry, so the switch lives on each page.
 */
export const KnowledgeViewTabs = ({ value, onChange }: Props) => {
  const { t } = useI18n();
  return (
    <SegmentedControl
      ariaPattern="tab"
      ariaLabel={t('sidebar.nodes')}
      className="knowledge-view-tabs"
      value={value}
      onChange={(id) => onChange(id as KnowledgeView)}
      options={[
        { id: 'list', label: t('workspaceNodes.view.list') },
        { id: 'graph', label: t('sidebar.graph') },
      ]}
    />
  );
};
