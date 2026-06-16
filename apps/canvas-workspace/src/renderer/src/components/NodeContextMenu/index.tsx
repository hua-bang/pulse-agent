import "./index.css";
import { createPortal } from "react-dom";
import { useViewportClampedPosition } from "../../hooks/useViewportClampedPosition";
import { useMenuKeyboardNav } from "../../hooks/useMenuKeyboardNav";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useI18n } from "../../i18n";

interface Props {
  x: number;
  y: number;
  mode?: "create" | "mindmap";
  onCreate?: (type: "file" | "terminal" | "frame" | "group" | "agent" | "text" | "iframe" | "mindmap") => void;
  onExportImage?: () => void;
  onClose: () => void;
}

export const NodeContextMenu = ({ x, y, mode = "create", onCreate, onExportImage, onClose }: Props) => {
  const { t } = useI18n();
  const { ref: menuRef, pos } = useViewportClampedPosition<HTMLDivElement>(x, y);

  // Arrow-key navigation + Escape; replaces the old window Escape
  // listener so the menu is fully operable without a mouse.
  useMenuKeyboardNav(menuRef, onClose);
  useClickOutside(menuRef, onClose);

  const menu = (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
    >
      {mode === "mindmap" ? (
        <>
          <div className="context-menu-title">{t('canvas.menu.mindmapTitle')}</div>
          <button
            className="context-menu-item" role="menuitem"
            onClick={() => onExportImage?.()}
          >
            <span className="context-menu-icon">{"\u21E9"}</span>
            <span className="context-menu-label">
              <strong>{t('canvas.menu.exportImage')}</strong>
              <small>{t('canvas.menu.exportImageDesc')}</small>
            </span>
          </button>
        </>
      ) : (
        <>
          <div className="context-menu-title">{t('canvas.menu.createTitle')}</div>
          <button
            className="context-menu-item" role="menuitem"
            onClick={() => onCreate?.("text")}
          >
            <span className="context-menu-icon">{"\u0041"}</span>
            <span className="context-menu-label">
              <strong>{t('canvas.menu.text')}</strong>
              <small>{t('canvas.menu.textDesc')}</small>
            </span>
          </button>
          <button
            className="context-menu-item" role="menuitem"
            onClick={() => onCreate?.("file")}
          >
            <span className="context-menu-icon">{"\u2756"}</span>
            <span className="context-menu-label">
              <strong>{t('canvas.menu.note')}</strong>
              <small>{t('canvas.menu.noteDesc')}</small>
            </span>
          </button>
          <button
            className="context-menu-item" role="menuitem"
            onClick={() => onCreate?.("frame")}
          >
            <span className="context-menu-icon">{"\u25A1"}</span>
            <span className="context-menu-label">
              <strong>{t('canvas.menu.frame')}</strong>
              <small>{t('canvas.menu.frameDesc')}</small>
            </span>
          </button>
          <button
            className="context-menu-item" role="menuitem"
            onClick={() => onCreate?.("iframe")}
          >
            <span className="context-menu-icon">{"\u232C"}</span>
            <span className="context-menu-label">
              <strong>{t('canvas.menu.web')}</strong>
              <small>{t('canvas.menu.webDesc')}</small>
            </span>
          </button>
          <button
            className="context-menu-item" role="menuitem"
            onClick={() => onCreate?.("agent")}
          >
            <span className="context-menu-icon">{"\u2726"}</span>
            <span className="context-menu-label">
              <strong>{t('canvas.menu.agent')}</strong>
              <small>{t('canvas.menu.agentDesc')}</small>
            </span>
          </button>
          <button
            className="context-menu-item" role="menuitem"
            onClick={() => onCreate?.("mindmap")}
          >
            <span className="context-menu-icon">{"✿"}</span>
            <span className="context-menu-label">
              <strong>{t('canvas.menu.mindmap')}</strong>
              <small>{t('canvas.menu.mindmapDesc')}</small>
            </span>
          </button>
        </>
      )}
    </div>
  );

  return createPortal(menu, document.body);
};
