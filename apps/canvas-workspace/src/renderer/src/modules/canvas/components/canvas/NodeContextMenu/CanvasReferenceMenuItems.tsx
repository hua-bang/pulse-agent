import { useState } from "react";
import { useI18n } from "../../../../../i18n";
import { NodeTypeIcon } from "../../../../../components/icons";
import { Button } from "../../../../../components/ui";
import type { WorkspaceEntry } from "../../../../../shared/workspaces";

interface Props {
  /** Every workspace except the current canvas. */
  workspaces: WorkspaceEntry[];
  onCreate: (workspaceId: string) => void;
}

/** "Canvas reference" row; it opens a list of the other workspaces in place. */
export const CanvasReferenceMenuItems = ({ workspaces, onCreate }: Props) => {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);

  if (workspaces.length === 0) return null;

  return (
    <>
      <Button
        size="sm"
        className="context-menu-item"
        role="menuitem"
        aria-expanded={picking}
        onClick={() => setPicking((open) => !open)}
      >
        <span className="context-menu-icon context-menu-icon--reference">
          <NodeTypeIcon type="reference" size={15} />
        </span>
        <span className="context-menu-label">
          <strong>{t("canvas.menu.canvasReference")}</strong>
          <small>{t("canvas.menu.canvasReferenceDesc")}</small>
        </span>
      </Button>
      {picking && (
        <div className="context-menu-workspaces" role="group" aria-label={t("canvas.menu.canvasReference")}>
          {workspaces.map((workspace) => (
            <Button
              key={workspace.id}
              size="sm"
              className="context-menu-item context-menu-workspace"
              role="menuitem"
              title={workspace.name}
              onClick={() => onCreate(workspace.id)}
            >
              {workspace.name}
            </Button>
          ))}
        </div>
      )}
    </>
  );
};
