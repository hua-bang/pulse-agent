import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ArtifactSummary } from '../../types';
import { Button, Popover, SegmentedControl } from '../ui';
import { useRightDock } from '../RightDock';
import { useI18n } from '../../i18n';

/** Storage scope of global-chat artifacts (not a canvas workspace). */
const GLOBAL_ARTIFACT_SCOPE = '__global_chat__';

type ArtifactScope = 'current' | 'all';

interface ArtifactsPickerProps {
  activeWorkspaceId: string;
  workspaceNameById: Map<string, string>;
  onPreviewArtifact: (artifact: {
    workspaceId: string;
    artifactId: string;
    title?: string;
    type?: ArtifactSummary['type'];
  }) => void;
}

const ArtifactIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2.5" y="2" width="11" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5 5.5h6M5 8h6M5 10.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const OpenInDockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M9.5 2.5v11M11 6l1.5 2-1.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PinIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M9.8 1.8l4.4 4.4-1.6.5-2.3 2.3-.3 2.9-2.7-2.7-4.2 4.2-.6-.6 4.2-4.2-2.7-2.7 2.9-.3 2.3-2.3.6-1.5z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      fill={filled ? 'currentColor' : 'none'}
    />
  </svg>
);

/**
 * "Artifacts" source tab of the Library drawer: browse artifact metadata by
 * scope, open one in the right dock, or pin it onto the current canvas.
 * Pinning is only legal inside the artifact's own workspace — the artifact
 * mirror resolves content by the host canvas's workspaceId, so cross-scope
 * pins are disabled rather than silently broken.
 */
export const ArtifactsPicker = ({ activeWorkspaceId, workspaceNameById, onPreviewArtifact }: ArtifactsPickerProps) => {
  const { t } = useI18n();
  const dock = useRightDock();
  const popoverId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ArtifactScope>('current');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ArtifactSummary[]>([]);
  const [pinningId, setPinningId] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    const api = window.canvasWorkspace?.artifacts;
    if (!api) return;
    setLoading(true);
    try {
      if (scope === 'all') {
        const res = await api.listAll();
        setItems(res.ok ? res.artifacts ?? [] : []);
        return;
      }
      const res = await api.list(activeWorkspaceId);
      const artifacts = res.ok ? res.artifacts ?? [] : [];
      setItems(artifacts
        .map((a) => ({
          id: a.id,
          workspaceId: a.workspaceId,
          type: a.type,
          title: a.title,
          versionCount: a.versions.length,
          ...(a.pinnedNodeId ? { pinnedNodeId: a.pinnedNodeId } : {}),
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt));
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, scope]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    return window.canvasWorkspace?.artifacts?.onChange(() => { void refresh(); });
  }, [open, refresh]);

  const handlePin = useCallback(async (item: ArtifactSummary) => {
    if (item.workspaceId !== activeWorkspaceId || item.pinnedNodeId) return;
    setPinningId(item.id);
    try {
      await window.canvasWorkspace?.artifacts?.pinToCanvas(item.workspaceId, item.id);
    } finally {
      setPinningId(undefined);
    }
  }, [activeWorkspaceId]);

  const scopeName = (workspaceId: string): string => (
    workspaceId === GLOBAL_ARTIFACT_SCOPE
      ? t('reference.artifactScopeGlobal')
      : workspaceNameById.get(workspaceId) ?? workspaceId
  );

  return (
    <>
      <Button
        ref={anchorRef}
        size="sm"
        className={`reference-drawer-action reference-drawer-action--ghost${open ? ' reference-drawer-action--open' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        title={t('reference.artifactsTitle')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
      >
        <ArtifactIcon />
        {t('reference.artifacts')}
      </Button>

      {open && (
        <Popover
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          className="reference-artifacts-popover"
          ariaLabel={t('reference.artifactsTitle')}
          panelId={popoverId}
          autoFocus={false}
        >
          <SegmentedControl
            className="reference-artifact-scopes"
            ariaLabel={t('reference.artifactsTitle')}
            value={scope}
            onChange={(id) => setScope(id as ArtifactScope)}
            options={[
              { id: 'current', label: t('reference.artifactScopeCurrent') },
              { id: 'all', label: t('reference.artifactScopeAll') },
            ]}
          />

          <div className="reference-picker-list" role="list" aria-label={t('reference.artifacts')}>
            {loading && items.length === 0 ? (
              <div className="reference-picker-empty">{t('reference.artifactsLoading')}</div>
            ) : items.length === 0 ? (
              <div className="reference-picker-empty">{t('reference.artifactsEmpty')}</div>
            ) : (
              items.map((item) => {
                const crossScope = item.workspaceId !== activeWorkspaceId;
                const pinned = !crossScope && !!item.pinnedNodeId;
                return (
                  <div
                    key={`${item.workspaceId}:${item.id}`}
                    className="reference-artifact-item"
                    role="listitem"
                    onClick={() => onPreviewArtifact({
                      workspaceId: item.workspaceId,
                      artifactId: item.id,
                      title: item.title,
                      type: item.type,
                    })}
                    title={t('reference.artifactPreviewTip')}
                  >
                    <div className="reference-artifact-row">
                      <span className="reference-artifact-type">{item.type.toUpperCase()}</span>
                      <span className="reference-artifact-title" title={item.title}>{item.title}</span>
                      <div
                        className="reference-artifact-actions"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Button
                          size="xs"
                          variant="icon"
                          className="reference-artifact-pin"
                          disabled={crossScope || pinned || pinningId === item.id}
                          aria-label={pinned ? t('reference.artifactPinned') : t('reference.artifactPin')}
                          title={crossScope
                            ? t('reference.artifactScopeBlocked')
                            : pinned ? t('reference.artifactPinned') : t('reference.artifactPin')}
                          onClick={() => { void handlePin(item); }}
                        >
                          <PinIcon filled={pinned} />
                        </Button>
                        <Button
                          size="xs"
                          variant="icon"
                          aria-label={t('reference.artifactOpenDock')}
                          title={t('reference.artifactOpenDock')}
                          onClick={() => dock.openArtifact(item.workspaceId, item.id)}
                        >
                          <OpenInDockIcon />
                        </Button>
                      </div>
                    </div>
                    <div className="reference-artifact-meta">
                      <span>v{item.versionCount}</span>
                      {scope !== 'current' && <span>{scopeName(item.workspaceId)}</span>}
                      <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Popover>
      )}
    </>
  );
};
