import { useCallback, useSyncExternalStore } from 'react';
import { NodeTypeIcon } from '../../../../components/icons';
import { useI18n } from '../../../../i18n';
import type { CanvasNode } from '../../../../types';
import type { NodeViewHost } from '../../internal/nodeViewHost';
import { NodeCard } from './NodeCard';
import './index.css';

interface Props {
  host: NodeViewHost;
}

export const NodeView = ({ host }: Props) => {
  const { t } = useI18n();
  const state = useSyncExternalStore(
    listener => host.subscribe(listener),
    () => host.snapshot,
  );
  const { node } = state;
  const onUpdate = useCallback(
    (id: string, patch: Partial<CanvasNode>) => host.update(id, patch),
    [host],
  );

  return (
    <div className="node-view">
      <header className="node-view-header">
        {node ? <NodeTypeIcon type={node.type} size={14} colorize /> : null}
        <span className="node-view-title">
          {node?.title || (state.phase === 'picker' ? t('mcpNodeView.pickTitle') : 'Pulse Canvas')}
        </span>
        {state.workspaceName ? <span className="node-view-workspace">{state.workspaceName}</span> : null}
        <span className="node-view-status" role="status" data-error={state.error ? 'true' : undefined}>
          {state.error
            ?? (state.saving ? t('mcpNodeView.saving') : node && !state.editable ? t('mcpNodeView.readOnly') : '')}
        </span>
      </header>

      {state.phase === 'connecting' || state.phase === 'loading' ? (
        <p className="node-view-muted node-view-pad">{t('mcpNodeView.loading')}</p>
      ) : null}

      {state.phase === 'error' && !node ? (
        <p className="node-view-error node-view-pad">{state.error}</p>
      ) : null}

      {state.phase === 'picker' ? (
        <ul className="node-view-picker">
          {state.candidates.length === 0 ? (
            <li className="node-view-muted">{t('mcpNodeView.noNodes')}</li>
          ) : state.candidates.map(candidate => (
            <li key={candidate.id}>
              <button
                type="button"
                onClick={() => void host.open({ workspaceId: state.workspaceId, nodeId: candidate.id })}
              >
                <NodeTypeIcon type={candidate.type as CanvasNode['type']} size={14} colorize />
                <span className="node-view-picker-title">{candidate.title || candidate.id}</span>
                {candidate.description ? (
                  <span className="node-view-picker-description">{candidate.description}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {node && state.phase !== 'picker' ? (
        <div className="node-view-stage">
          <NodeCard
            key={node.id}
            node={node}
            editable={state.editable}
            onUpdate={onUpdate}
          />
        </div>
      ) : null}
    </div>
  );
};
