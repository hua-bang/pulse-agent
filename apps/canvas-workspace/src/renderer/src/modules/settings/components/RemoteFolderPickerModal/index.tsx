import { useCallback, useEffect, useId, useState } from 'react';
import type {
  RemoteVpsDirEntry,
  RemoteVpsWorkspaceConfigDto,
} from '../../../../../../shared/api/remote-vps';
import { Button, Modal, TextField } from '../../../../components/ui';
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
  const titleId = useId();
  const [currentPath, setCurrentPath] = useState(initialPath || '~');
  const [pathInput, setPathInput] = useState(initialPath || '~');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [entries, setEntries] = useState<RemoteVpsDirEntry[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDir = useCallback(
    async (targetPath: string, includeHidden: boolean) => {
      const api = window.canvasWorkspace?.remoteVps;
      if (!api) {
        setError('当前环境不支持远端目录浏览。');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await api.listDirs(workspaceId, targetPath, {
          showHidden: includeHidden,
          config,
        });
        if (!res.ok) {
          const raw = res.error || '无法读取远端目录';
          setError(
            raw.includes('Route not found')
              ? '远端 VPS daemon 版本较旧，请先在设置中点击「推送并测试连接」自动升级。'
              : raw,
          );
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
    [workspaceId, config],
  );

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
          <span className="vps-folder-modal-eyebrow">REMOTE VPS</span>
          <h2 id={titleId} className="vps-folder-modal-title">选择远端文件夹</h2>
        </div>
        <Button variant="icon" onClick={onClose} aria-label="关闭">
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
          aria-label="远端路径"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => parentPath && handleNavigate(parentPath)}
          disabled={!parentPath || loading}
          title="上一级目录"
        >
          上级
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleNavigate(homePath || '~')}
          disabled={loading}
          title="主目录"
        >
          ~
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleNavigate(currentPath)}
          disabled={loading}
          title="刷新"
        >
          刷新
        </Button>
      </div>

      <div className="vps-folder-modal-body">
        {error ? (
          <div className="vps-folder-modal-error">{error}</div>
        ) : loading && entries.length === 0 ? (
          <div className="vps-folder-modal-empty">正在读取远端目录…</div>
        ) : entries.length === 0 ? (
          <div className="vps-folder-modal-empty">该目录下没有子文件夹</div>
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
          {showHidden ? '隐藏点目录' : '显示隐藏目录'}
        </Button>
        <div className="vps-folder-modal-actions">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={loading || !currentPath}>
            选择此文件夹
          </Button>
        </div>
      </div>
    </Modal>
  );
};
