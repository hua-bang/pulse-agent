import { useI18n } from '../../../../../i18n';
import { GRAPH_COLORS } from '../../ForceGraphCanvas';

interface Props {
  showTags: boolean;
  showWorkspaces: boolean;
}

/** Names what each dot colour means; kinds absent from the graph are left out. */
export const GraphLegend = ({ showTags, showWorkspaces }: Props) => {
  const { t } = useI18n();
  return (
    <div className="workspace-graph-legend">
      <span><i style={{ background: GRAPH_COLORS.node }} />{t('workspaceNodes.genericNode')}</span>
      {showTags && <span><i style={{ background: GRAPH_COLORS.tag }} />{t('workspaceGraph.tagResult')}</span>}
      {showWorkspaces && (
        <span><i style={{ background: GRAPH_COLORS.workspace }} />{t('reference.workspace')}</span>
      )}
    </div>
  );
};
