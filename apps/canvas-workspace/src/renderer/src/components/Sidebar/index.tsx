import { useEffect, useRef, useState, useCallback, type DragEvent } from 'react';
import type { WorkspaceEntry, FolderEntry } from '../../hooks/useWorkspaces';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  workspaces: WorkspaceEntry[];
  folders: FolderEntry[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSetRootFolder: (id: string, folderPath: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onMoveWorkspace: (workspaceId: string, folderId: string | undefined) => void;
}

/* ---- Drag data helpers ---- */
const DRAG_TYPE = 'application/x-workspace-id';

export const Sidebar = ({
  collapsed,
  onToggle,
  workspaces,
  folders,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onSetRootFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onMoveWorkspace,
}: Props) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null); // folder id or '__root__'

  const renameInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const renameFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (creating && newInputRef.current) newInputRef.current.focus();
  }, [creating]);

  useEffect(() => {
    if (creatingFolder && newFolderInputRef.current) newFolderInputRef.current.focus();
  }, [creatingFolder]);

  useEffect(() => {
    if (renamingFolderId && renameFolderInputRef.current) {
      renameFolderInputRef.current.focus();
      renameFolderInputRef.current.select();
    }
  }, [renamingFolderId]);

  /* ---- Workspace rename ---- */
  const startRename = (ws: WorkspaceEntry) => {
    setRenamingId(ws.id);
    setRenameValue(ws.name);
  };
  const commitRename = () => {
    if (renamingId) onRename(renamingId, renameValue);
    setRenamingId(null);
  };
  const cancelRename = () => setRenamingId(null);

  /* ---- Workspace create ---- */
  const commitCreate = () => {
    if (newName.trim()) onCreate(newName.trim());
    setNewName('');
    setCreating(false);
  };
  const cancelCreate = () => {
    setNewName('');
    setCreating(false);
  };

  /* ---- Folder rename ---- */
  const startFolderRename = (f: FolderEntry) => {
    setRenamingFolderId(f.id);
    setRenameFolderValue(f.name);
  };
  const commitFolderRename = () => {
    if (renamingFolderId) onRenameFolder(renamingFolderId, renameFolderValue);
    setRenamingFolderId(null);
  };
  const cancelFolderRename = () => setRenamingFolderId(null);

  /* ---- Folder create ---- */
  const commitFolderCreate = () => {
    if (newFolderName.trim()) onCreateFolder(newFolderName.trim());
    setNewFolderName('');
    setCreatingFolder(false);
  };
  const cancelFolderCreate = () => {
    setNewFolderName('');
    setCreatingFolder(false);
  };

  /* ---- Skills install ---- */
  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'done' | 'partial'>('idle');
  const [installMessage, setInstallMessage] = useState('');

  const handleInstallSkills = useCallback(async () => {
    const api = window.canvasWorkspace?.skills;
    if (!api) return;
    setInstallStatus('installing');
    setInstallMessage('');
    const result = await api.install();
    if (!result.ok) {
      setInstallStatus('idle');
      setInstallMessage(`Failed: ${result.error}`);
      return;
    }
    if (result.cliInstalled) {
      setInstallStatus('done');
      setInstallMessage('Canvas CLI and Skills installed successfully.');
    } else {
      setInstallStatus('partial');
      setInstallMessage(
        `Skills installed. To enable CLI, run:\n${result.manualCommand ?? 'pnpm --filter @pulse-coder/canvas-cli build && pnpm link --global --filter @pulse-coder/canvas-cli'}`
      );
    }
  }, []);

  const pickFolder = async (wsId: string) => {
    const api = window.canvasWorkspace?.dialog;
    if (!api) return;
    const result = await api.openFolder();
    if (result.ok && result.folderPath) {
      onSetRootFolder(wsId, result.folderPath);
    }
  };

  /* ---- Drag & Drop handlers ---- */
  const handleDragStart = (e: DragEvent, wsId: string) => {
    e.dataTransfer.setData(DRAG_TYPE, wsId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: DragEvent, targetId: string) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(targetId);
  };

  const handleDragLeave = (e: DragEvent, targetId: string) => {
    // Only clear if leaving the actual target (not entering a child)
    const related = e.relatedTarget as HTMLElement | null;
    const current = e.currentTarget as HTMLElement;
    if (related && current.contains(related)) return;
    if (dropTarget === targetId) setDropTarget(null);
  };

  const handleDrop = (e: DragEvent, folderId: string | undefined) => {
    e.preventDefault();
    const wsId = e.dataTransfer.getData(DRAG_TYPE);
    if (wsId) onMoveWorkspace(wsId, folderId);
    setDropTarget(null);
  };

  const handleDragEnd = () => setDropTarget(null);

  /* ---- Render a workspace item ---- */
  const renderWorkspaceItem = (ws: WorkspaceEntry) => (
    <div
      key={ws.id}
      className="sidebar-workspace-entry"
      draggable
      onDragStart={(e) => handleDragStart(e, ws.id)}
      onDragEnd={handleDragEnd}
    >
      <div className="sidebar-item-row">
        {renamingId === ws.id ? (
          <input
            ref={renameInputRef}
            className="sidebar-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') cancelRename();
            }}
          />
        ) : (
          <button
            className={`sidebar-item${activeId === ws.id ? ' sidebar-item--active' : ''}`}
            onClick={() => onSelect(ws.id)}
            onDoubleClick={() => startRename(ws)}
            title="Drag to move · Double-click to rename"
          >
            <span className="sidebar-item-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </span>
            <span className="sidebar-item-name">{ws.name}</span>
          </button>
        )}
        {workspaces.length > 1 && renamingId !== ws.id && (
          <button className="sidebar-item-delete" onClick={() => onDelete(ws.id)} title="Delete workspace">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      {ws.rootFolder && (
        <div className="sidebar-root-folder" title={ws.rootFolder}>
          {ws.rootFolder.split('/').slice(-2).join('/')}
        </div>
      )}
    </div>
  );

  /* ---- Root-level workspaces (no folder) ---- */
  const rootWorkspaces = workspaces.filter((ws) => !ws.folderId);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      {!collapsed && (
        <>
          <div className="sidebar-section-title">Workspaces</div>

          {/* Root drop zone */}
          <div
            className={`sidebar-list sidebar-drop-zone${dropTarget === '__root__' ? ' sidebar-drop-zone--active' : ''}`}
            onDragOver={(e) => handleDragOver(e, '__root__')}
            onDragLeave={(e) => handleDragLeave(e, '__root__')}
            onDrop={(e) => handleDrop(e, undefined)}
          >
            {rootWorkspaces.map(renderWorkspaceItem)}
          </div>

          {/* Folders */}
          {folders.map((folder) => {
            const folderWorkspaces = workspaces.filter((ws) => ws.folderId === folder.id);
            const isCollapsed = folder.collapsed;
            const isDrop = dropTarget === folder.id;

            return (
              <div key={folder.id} className="sidebar-folder">
                <div className="sidebar-folder-header">
                  {renamingFolderId === folder.id ? (
                    <input
                      ref={renameFolderInputRef}
                      className="sidebar-rename-input"
                      value={renameFolderValue}
                      onChange={(e) => setRenameFolderValue(e.target.value)}
                      onBlur={commitFolderRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitFolderRename();
                        if (e.key === 'Escape') cancelFolderRename();
                      }}
                    />
                  ) : (
                    <button
                      className="sidebar-folder-toggle"
                      onClick={() => onToggleFolder(folder.id)}
                      onDoubleClick={() => startFolderRename(folder)}
                      title="Double-click to rename"
                    >
                      <span className={`sidebar-folder-chevron${isCollapsed ? '' : ' sidebar-folder-chevron--open'}`}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="sidebar-folder-icon">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 1.5h5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.2" />
                        </svg>
                      </span>
                      <span className="sidebar-folder-name">{folder.name}</span>
                      <span className="sidebar-folder-count">{folderWorkspaces.length}</span>
                    </button>
                  )}
                  {renamingFolderId !== folder.id && (
                    <button
                      className="sidebar-folder-delete"
                      onClick={() => onDeleteFolder(folder.id)}
                      title="Delete folder"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>
                <div
                  className={`sidebar-folder-children${isCollapsed ? ' sidebar-folder-children--collapsed' : ''}${isDrop ? ' sidebar-drop-zone--active' : ''}`}
                  onDragOver={(e) => handleDragOver(e, folder.id)}
                  onDragLeave={(e) => handleDragLeave(e, folder.id)}
                  onDrop={(e) => handleDrop(e, folder.id)}
                >
                  {!isCollapsed && folderWorkspaces.map(renderWorkspaceItem)}
                  {!isCollapsed && folderWorkspaces.length === 0 && (
                    <div className="sidebar-folder-empty">Drop workspaces here</div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Create inputs */}
          {creating && (
            <div className="sidebar-list">
              <div className="sidebar-item-row">
                <input
                  ref={newInputRef}
                  className="sidebar-rename-input sidebar-rename-input--new"
                  placeholder="Workspace name…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={() => (newName.trim() ? commitCreate() : cancelCreate())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitCreate();
                    if (e.key === 'Escape') cancelCreate();
                  }}
                />
              </div>
            </div>
          )}

          {creatingFolder && (
            <div className="sidebar-list">
              <div className="sidebar-item-row">
                <input
                  ref={newFolderInputRef}
                  className="sidebar-rename-input sidebar-rename-input--new"
                  placeholder="Folder name…"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onBlur={() => (newFolderName.trim() ? commitFolderCreate() : cancelFolderCreate())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitFolderCreate();
                    if (e.key === 'Escape') cancelFolderCreate();
                  }}
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="sidebar-list" style={{ marginTop: 4 }}>
            <button className="sidebar-item sidebar-item--muted" onClick={() => setCreating(true)}>
              <span className="sidebar-item-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
              <span className="sidebar-item-name">New Workspace</span>
            </button>
            <button className="sidebar-item sidebar-item--muted" onClick={() => setCreatingFolder(true)}>
              <span className="sidebar-item-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.5 1.5h5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M8 6.5v4M6 8.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </span>
              <span className="sidebar-item-name">New Folder</span>
            </button>
          </div>
        </>
      )}

      {!collapsed && (
        <div className="sidebar-install-section">
          <button
            className="sidebar-item sidebar-item--muted"
            onClick={handleInstallSkills}
            disabled={installStatus === 'installing'}
            title="Install canvas CLI and skills for agent discovery"
          >
            <span className="sidebar-item-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 2v8M5 7l3 3 3-3M3 12h10"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="sidebar-item-name">
              {installStatus === 'installing' ? 'Installing...' : 'Install for Agents'}
            </span>
          </button>
          {installMessage && (
            <div className="sidebar-install-message">{installMessage}</div>
          )}
        </div>
      )}

      <div className="sidebar-footer">
        <button className="sidebar-toggle" onClick={onToggle} title="Toggle sidebar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d={collapsed ? 'M6 3l5 5-5 5' : 'M10 3L5 8l5 5'}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </aside>
  );
};
