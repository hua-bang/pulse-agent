import './index.css';
import { Popover } from '../ui/Popover';
import { useI18n } from '../../i18n';
import type { CreatableCanvasNodeType } from '../../utils/nodeFactory';
import { useRightDock } from '../RightDock';

interface Props {
  x: number;
  y: number;
  mode?: "create" | "mindmap";
  onCreate?: (type: CreatableCanvasNodeType) => void;
  onExportImage?: () => void;
  onClose: () => void;
}

type ContextMenuIconKind = CreatableCanvasNodeType | 'export';

const ContextMenuIcon = ({ kind }: { kind: ContextMenuIconKind }) => {
  if (kind === 'file') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 3h10v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3z" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.5 7h5M5.5 9.5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'frame') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" />
      </svg>
    );
  }
  if (kind === 'iframe') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'terminal') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.5 7l2 1.5-2 1.5M8 10.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'agent') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M5.7 4.5L2.7 8l3 3.5M10.3 4.5l3 3.5-3 3.5M8.9 4l-1.8 8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'mindmap') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="4" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.25" />
        <circle cx="12" cy="4" r="1.35" stroke="currentColor" strokeWidth="1.15" />
        <circle cx="12" cy="8" r="1.35" stroke="currentColor" strokeWidth="1.15" />
        <circle cx="12" cy="12" r="1.35" stroke="currentColor" strokeWidth="1.15" />
        <path d="M5.7 7.4l4.9-2.6M5.8 8h4.7M5.7 8.6l4.9 2.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'export') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 10V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M5.5 5.5L8 3l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 9v3.5A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4h10M8 4v9M6 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
};

const CreateMenuItem = ({
  type,
  title,
  description,
  onCreate,
}: {
  type: CreatableCanvasNodeType;
  title: string;
  description: string;
  onCreate?: (type: CreatableCanvasNodeType) => void;
}) => (
  <button
    className="context-menu-item"
    role="menuitem"
    onClick={() => onCreate?.(type)}
  >
    <span className={`context-menu-icon context-menu-icon--${type}`}>
      <ContextMenuIcon kind={type} />
    </span>
    <span className="context-menu-label">
      <strong>{title}</strong>
      <small>{description}</small>
    </span>
  </button>
);

export const NodeContextMenu = ({ x, y, mode = "create", onCreate, onExportImage, onClose }: Props) => {
  const { t } = useI18n();
  const dock = useRightDock();

  return (
    <Popover x={x} y={y} onClose={onClose} className="context-menu">
      {mode === "mindmap" ? (
        <>
          <div className="context-menu-title">{t('canvas.menu.mindmapTitle')}</div>
          <button
            className="context-menu-item" role="menuitem"
            onClick={() => onExportImage?.()}
          >
            <span className="context-menu-icon context-menu-icon--export">
              <ContextMenuIcon kind="export" />
            </span>
            <span className="context-menu-label">
              <strong>{t('canvas.menu.exportImage')}</strong>
              <small>{t('canvas.menu.exportImageDesc')}</small>
            </span>
          </button>
        </>
      ) : (
        <>
          <div className="context-menu-title">{t('canvas.menu.createTitle')}</div>
          <CreateMenuItem type="text" title={t('canvas.menu.text')} description={t('canvas.menu.textDesc')} onCreate={onCreate} />
          <CreateMenuItem type="file" title={t('canvas.menu.note')} description={t('canvas.menu.noteDesc')} onCreate={onCreate} />
          <CreateMenuItem type="frame" title={t('canvas.menu.frame')} description={t('canvas.menu.frameDesc')} onCreate={onCreate} />
          <CreateMenuItem type="iframe" title={t('canvas.menu.web')} description={t('canvas.menu.webDesc')} onCreate={onCreate} />
          <button
            className="context-menu-item"
            role="menuitem"
            onClick={() => {
              dock.openTerminal();
              onClose();
            }}
          >
            <span className="context-menu-icon context-menu-icon--terminal">
              <ContextMenuIcon kind="terminal" />
            </span>
            <span className="context-menu-label">
              <strong>{t('canvas.menu.terminal')}</strong>
              <small>{t('canvas.menu.terminalDesc')}</small>
            </span>
          </button>
          <CreateMenuItem type="agent" title={t('canvas.menu.agent')} description={t('canvas.menu.agentDesc')} onCreate={onCreate} />
          <CreateMenuItem type="mindmap" title={t('canvas.menu.mindmap')} description={t('canvas.menu.mindmapDesc')} onCreate={onCreate} />
        </>
      )}
    </Popover>
  );
};
