import "./index.css";
import { Popover } from "../../ui/Popover";
import { useI18n } from "../../../i18n";
import type { CreatableCanvasNodeType } from "../../../utils/nodeFactory";
import { useRightDock } from "../../dock/RightDock";
import { ExportIcon, NodeTypeIcon } from "../../icons";

interface Props {
  x: number;
  y: number;
  mode?: "create" | "mindmap";
  onCreate?: (type: CreatableCanvasNodeType) => void;
  onExportImage?: () => void;
  onClose: () => void;
}

type ContextMenuIconKind = CreatableCanvasNodeType | 'export';

const ContextMenuIcon = ({ kind }: { kind: ContextMenuIconKind }) => (
  kind === 'export'
    ? <ExportIcon size={15} />
    : <NodeTypeIcon type={kind} size={15} />
);

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
