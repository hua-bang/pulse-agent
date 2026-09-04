import '@xterm/xterm/css/xterm.css';
import { useI18n } from '../../../../../i18n';
import { formatShortcutId } from '../../../../../shortcuts/registry';
import type { CanvasNode } from '../../../../../types';
import { NodeMentionPicker } from '../../../../node-mentions';
import { useTerminalNodeRuntime } from './useTerminalNodeRuntime';
import './index.css';

interface Props {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  onUpdate: (
    id: string,
    patch: Partial<CanvasNode>,
    options?: { history?: boolean },
  ) => void;
  readOnly?: boolean;
}

export const TerminalNodeBody = ({
  node,
  getAllNodes,
  rootFolder,
  workspaceId,
  onUpdate,
  readOnly = false,
}: Props) => {
  const { t } = useI18n();
  const runtime = useTerminalNodeRuntime({
    node,
    rootFolder,
    workspaceId,
    onUpdate,
    readOnly,
  });

  return (
    <div className="terminal-body-wrap">
      {!readOnly && runtime.pickerOpen && (
        <NodeMentionPicker
          nodes={getAllNodes?.() ?? []}
          onSelect={runtime.handleMentionSelect}
          onClose={runtime.handleMentionClose}
        />
      )}
      {!readOnly && runtime.mentionHintVisible && !runtime.pickerOpen && (
        <div className="terminal-mention-hint" role="status">
          <span>{t('terminal.mentionHint.prefix')}</span>
          <kbd>{formatShortcutId('terminal.mentionPicker')}</kbd>
          <span>{t('terminal.mentionHint.suffix')}</span>
          <button
            type="button"
            className="terminal-mention-hint__close"
            aria-label={t('terminal.mentionHint.dismiss')}
            onClick={runtime.dismissMentionHint}
          >
            ×
          </button>
        </div>
      )}
      <div
        ref={runtime.containerRef}
        className="terminal-xterm-container"
        onMouseDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      />
    </div>
  );
};
