import { lazy, Suspense, useCallback, useId, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { useI18n } from '../../i18n';
import { ExternalLinkIcon, PlusIcon } from '../icons';
import { Button } from '../ui';
import type { DockStore } from './dock-store';

const NewDockTabMenu = lazy(() => (
  import('./NewDockTabMenu').then((module) => ({ default: module.NewDockTabMenu }))
));
const NodeDockPicker = lazy(() => (
  import('./NodeDockPicker').then((module) => ({ default: module.NodeDockPicker }))
));

interface LinkActionProps {
  mode: 'link';
  url: string;
  activeWorkspaceId: string;
  onRequestClose: () => void;
}

const LinkTabActions = ({ url, activeWorkspaceId, onRequestClose }: LinkActionProps) => {
  const { t } = useI18n();

  const handleOpenInBrowser = useCallback(() => {
    if (!url) return;
    void window.canvasWorkspace.shell.openExternal(url);
  }, [url]);

  const handleAddToCanvas = useCallback(() => {
    if (!url || !activeWorkspaceId) return;
    window.dispatchEvent(
      new CustomEvent('canvas:add-iframe-from-url', {
        detail: { workspaceId: activeWorkspaceId, url },
      }),
    );
    onRequestClose();
  }, [url, activeWorkspaceId, onRequestClose]);

  return (
    <div className="right-dock__link-actions">
      <button
        type="button"
        className="right-dock__link-action right-dock__link-action--ghost"
        aria-label={t('linkDrawer.openInBrowser')}
        title={t('linkDrawer.openInBrowser')}
        onClick={handleOpenInBrowser}
      >
        <ExternalLinkIcon size={14} />
      </button>
      <button
        type="button"
        className="right-dock__link-action right-dock__link-action--primary"
        aria-label={t('linkDrawer.addToCanvas')}
        onClick={handleAddToCanvas}
        disabled={!activeWorkspaceId}
        title={activeWorkspaceId ? t('linkDrawer.addToCanvas') : t('linkDrawer.noActiveCanvas')}
      >
        <PlusIcon size={13} />
      </button>
    </div>
  );
};

interface CreationProps {
  mode?: 'create';
  store: DockStore;
  workspaces: WorkspaceEntry[];
  activeWorkspaceId: string;
  showTerminal: boolean;
  newTabTitle: string;
}

type Props = LinkActionProps | CreationProps;

export const DockCreationControls = (props: Props) => {
  if (props.mode === 'link') {
    return <LinkTabActions {...props} />;
  }

  const { store, workspaces, activeWorkspaceId, showTerminal, newTabTitle } = props;
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [nodePickerOpen, setNodePickerOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  return (
    <>
      <span ref={anchorRef} className="right-dock__new-tab-menu">
        <Button
          variant="icon"
          size="sm"
          className="right-dock__new-link"
          aria-label={t('rightDock.newTab')}
          title={t('rightDock.newTab')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? panelId : undefined}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <PlusIcon size={16} />
        </Button>
        {menuOpen && (
          <Suspense fallback={null}>
            <NewDockTabMenu
              anchorRef={anchorRef}
              panelId={panelId}
              showTerminal={showTerminal}
              onClose={() => setMenuOpen(false)}
              onOpenNode={() => setNodePickerOpen(true)}
              onNewWebTab={() => store.newLink(newTabTitle)}
              onNewTerminalTab={() => store.newTerminal()}
            />
          </Suspense>
        )}
      </span>
      {nodePickerOpen && (
        <Suspense fallback={null}>
          <NodeDockPicker
            workspaces={workspaces}
            onClose={() => setNodePickerOpen(false)}
            onSelect={(node) => store.openNodeDetail(
              node.workspaceId ?? activeWorkspaceId,
              node.id,
              node.displayTitle ?? node.title ?? node.id,
            )}
          />
        </Suspense>
      )}
    </>
  );
};
