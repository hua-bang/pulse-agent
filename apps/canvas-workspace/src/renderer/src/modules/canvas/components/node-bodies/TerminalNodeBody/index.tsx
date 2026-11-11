import '@xterm/xterm/css/xterm.css';
import { useState } from 'react';
import { Button } from '../../../../../components/ui';
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

/**
 * Restart remounts the session with a new key. The node, its position, and
 * its edges stay; the new shell restores the saved tail like an app relaunch.
 */
export const TerminalNodeBody = (props: Props) => {
  const [generation, setGeneration] = useState(0);
  return (
    <TerminalSession
      key={generation}
      {...props}
      onRestart={() => setGeneration((value) => value + 1)}
    />
  );
};

const TerminalSession = ({
  node,
  getAllNodes,
  rootFolder,
  workspaceId,
  onUpdate,
  readOnly = false,
  onRestart,
}: Props & { onRestart: () => void }) => {
  const { t } = useI18n();
  const runtime = useTerminalNodeRuntime({
    node,
    rootFolder,
    workspaceId,
    onUpdate,
    readOnly,
    onRestart: readOnly ? undefined : onRestart,
  });
  const exited = !readOnly && runtime.exitCode !== null;

  return (
    <div className="terminal-body-wrap">
      {!readOnly && runtime.pickerOpen && (
        <NodeMentionPicker
          nodes={getAllNodes?.() ?? []}
          onSelect={runtime.handleMentionSelect}
          onClose={runtime.handleMentionClose}
        />
      )}
      {exited && (
        <div className="terminal-exit-bar" role="status">
          <span>{t('terminal.exited', { code: runtime.exitCode })}</span>
          <Button
            variant="primary"
            size="xs"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onRestart}
          >
            {t('terminal.restart')}
          </Button>
          <kbd>↵</kbd>
        </div>
      )}
      {!readOnly && runtime.mentionHintVisible && !runtime.pickerOpen && !exited && (
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
