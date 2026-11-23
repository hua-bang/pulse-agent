import { useCallback, useEffect, useId, useState } from 'react';
import type {
  RemoteVpsDirEntry,
  RemoteVpsWorkspaceConfigDto,
} from '../../../../../../shared/api/remote-vps';
import { Button, Modal, TextField } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';
import './index.css';

export interface RemoteFolderPickerModalProps {
  open: boolean;
  workspaceId: string;
  initialPath?: string;
  config?: RemoteVpsWorkspaceConfigDto;
  onSelect: (folderPath: string) => void;
  onClose: () => void;
}

const FolderIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="vps-folder-modal-icon">
    <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 1.5h5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.35" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="vps-folder-modal-chevron">
    <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const RemoteFolderPickerModal = ({
  open,
  workspaceId,
  initialPath,
  config,
  onSelect,
  onClose,
}: RemoteFolderPickerModalProps) => {
  const { t } = useI18n();
  const titleId = useId();
  const [currentPath, setCurrentPath] = useState(initialPath || '~');
  const [pathInput, setPathInput] = useState(initialPath || '~');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [entries, setEntries] = useState<RemoteVpsDirEntry[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [oldDaemon, setOldDaemon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDir = useCallback(
    async (targetPath: string, includeHidden: boolean) => {
      const api = window.canvasWorkspace?.remoteVps;
      if (!api) {
        setError(t('remoteFolder.unavailable'));
        return;
      }
      setLoading(true);
      setError(null);
      setOldDaemon(false);
      try {
        const res = await api.listDirs(workspaceId, targetPath, {
          showHidden: includeHidden,
          config,
        });
        if (!res.ok) {
          const raw = res.error || t('remoteFolder.loadFailed');
          if (raw.includes('Route not found')) {
            setOldDaemon(true);
            setError(t('remoteFolder.oldDaemonError'));
          } else {
            setError(raw);
          }
          return;
        }
        const resolved = res.path || targetPath;
        setCurrentPath(resolved);
        setPathInput(resolved);
        setParentPath(res.parent ?? null);
        setHomePath(res.home ?? null);
        setEntries(res.entries ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, config, t],
  );

  const handleUpgradeDaemon = useCallback(async () => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api) return;
    setUpgrading(true);
    try {
      const activeConfig = config ?? (await api.getConfig(workspaceId)).config;
      if (!activeConfig) {
        setError(t('remoteFolder.loadFailed'));
        return;
      }
      const res = await api.testAndBootstrap(workspaceId, activeConfig);
      if (!res.ok) {
        setError(res.error || t('remoteVps.connectFailed'));
        return;
      }
      if (res.token && res.token !== activeConfig.token) {
        await api.saveConfig(workspaceId, { ...activeConfig, token: res.token });
      }
      await loadDir(currentPath, showHidden);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpgrading(false);
    }
  }, [config, workspaceId, currentPath, showHidden, loadDir, t]);

  useEffect(() => {
    if (!open) return;
    const start = initialPath?.trim() || '~';
    setCurrentPath(start);
    setPathInput(start);
    void loadDir(start, showHidden);
  }, [open, initialPath, showHidden, loadDir]);

  const handleNavigate = (nextPath: string) => {
    void loadDir(nextPath, showHidden);
  };

  const handleConfirm = () => {
    const chosen = currentPath.trim() || pathInput.trim();
    if (!chosen) return;
    onSelect(chosen);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} width={520} labelledBy={titleId} className="vps-folder-modal">
      <div className="vps-folder-modal-header">
        <div>
          <span className="vps-folder-modal-eyebrow">{t('remoteFolder.eyebrow')}</span>
          <h2 id={titleId} className="vps-folder-modal-title">{t('remoteFolder.title')}</h2>
        </div>
        <Button variant="icon" onClick={onClose} aria-label={t('remoteFolder.close')}>
          <CloseIcon />
        </Button>
      </div>

      <div className="vps-folder-modal-toolbar">
        <TextField
          className="vps-folder-modal-path"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleNavigate(pathInput.trim() || '~');
            }
          }}
          placeholder="/root/projects"
          spellCheck={false}
          aria-label={t('remoteFolder.pathLabel')}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => parentPath && handleNavigate(parentPath)}
          disabled={!parentPath || loading}
          title={t('remoteFolder.upTitle')}
        >
          {t('remoteFolder.up')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleNavigate(homePath || '~')}
          disabled={loading}
          title={t('remoteFolder.homeTitle')}
        >
          ~
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleNavigate(currentPath)}
          disabled={loading}
          title={t('remoteFolder.refresh')}
        >
          {t('remoteFolder.refresh')}
        </Button>
      </div>

      <div className="vps-folder-modal-body">
        {error ? (
          <div className="vps-folder-modal-error">
            <div>{error}</div>
            {oldDaemon && (
              <div className="vps-folder-modal-upgrade">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={upgrading}
                  onClick={() => { void handleUpgradeDaemon(); }}
                >
                  {upgrading ? t('remoteFolder.upgradingDaemon') : t('remoteFolder.upgradeDaemon')}
                </Button>
              </div>
            )}
          </div>
        ) : loading && entries.length === 0 ? (
          <div className="vps-folder-modal-empty">{t('remoteFolder.loading')}</div>
        ) : entries.length === 0 ? (
          <div className="vps-folder-modal-empty">{t('remoteFolder.empty')}</div>
        ) : (
          <div className="vps-folder-modal-list">
            {entries.map((entry) => (
              <Button
                key={entry.path}
                variant="secondary"
                className="vps-folder-modal-row"
                onClick={() => handleNavigate(entry.path)}
              >
                <FolderIcon />
                <span className="vps-folder-modal-name">{entry.name}</span>
                <ChevronRightIcon />
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="vps-folder-modal-footer">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowHidden((prev) => !prev)}
        >
          {showHidden ? t('remoteFolder.hideHidden') : t('remoteFolder.showHidden')}
        </Button>
        <div className="vps-folder-modal-actions">
          <Button variant="secondary" onClick={onClose}>{t('remoteFolder.cancel')}</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={loading || !currentPath}>
            {t('remoteFolder.selectCurrent')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
