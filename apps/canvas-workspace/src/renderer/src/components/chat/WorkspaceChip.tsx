import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceOption } from './types';

const FolderIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <path
      d="M1.8 4.2a1 1 0 0 1 1-1h2.4l1 1.2h4a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1V4.2Z"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
  </svg>
);

const UnboundIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 1.6" />
  </svg>
);

const CaretIcon = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" fill="none">
    <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <path d="M3 7.5L6 10L11 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface WorkspaceChipProps {
  workspaceId: string | null;
  allWorkspaces: WorkspaceOption[];
  onChange: (workspaceId: string | null) => void;
}

/**
 * Topbar chip that shows the current AI Chat workspace binding. Clicking
 * opens a small picker with every workspace plus an explicit "无工作区"
 * option to unbind. Pure UI — actual state lives in the parent ChatPage.
 */
export const WorkspaceChip = ({ workspaceId, allWorkspaces, onChange }: WorkspaceChipProps) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const currentName = useMemo(() => {
    if (workspaceId === null) return null;
    return allWorkspaces.find(w => w.id === workspaceId)?.name ?? workspaceId;
  }, [workspaceId, allWorkspaces]);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const handleSelect = useCallback((id: string | null) => {
    setOpen(false);
    if (id !== workspaceId) {
      onChange(id);
    }
  }, [workspaceId, onChange]);

  const isUnbound = workspaceId === null;

  return (
    <div className="workspace-chip-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className={`workspace-chip${isUnbound ? ' workspace-chip--unbound' : ''}`}
        onClick={() => setOpen(v => !v)}
        title={isUnbound ? '当前未绑定工作区 — 点击选择' : `当前工作区：${currentName} — 点击切换`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="workspace-chip-icon">
          {isUnbound ? <UnboundIcon /> : <FolderIcon />}
        </span>
        <span className="workspace-chip-label">
          {isUnbound ? '未绑定工作区' : currentName}
        </span>
        <span className="workspace-chip-caret">
          <CaretIcon />
        </span>
      </button>

      {open && (
        <div className="workspace-chip-popup" role="listbox">
          <button
            type="button"
            className={`workspace-chip-item${isUnbound ? ' workspace-chip-item--active' : ''}`}
            onClick={() => handleSelect(null)}
            role="option"
            aria-selected={isUnbound}
          >
            <span className="workspace-chip-item-icon"><UnboundIcon /></span>
            <span className="workspace-chip-item-label">无工作区</span>
            {isUnbound && <span className="workspace-chip-item-check"><CheckIcon /></span>}
          </button>
          {allWorkspaces.length > 0 && <div className="workspace-chip-divider" />}
          {allWorkspaces.map(workspace => {
            const isActive = workspace.id === workspaceId;
            return (
              <button
                key={workspace.id}
                type="button"
                className={`workspace-chip-item${isActive ? ' workspace-chip-item--active' : ''}`}
                onClick={() => handleSelect(workspace.id)}
                role="option"
                aria-selected={isActive}
              >
                <span className="workspace-chip-item-icon"><FolderIcon /></span>
                <span className="workspace-chip-item-label">{workspace.name}</span>
                {isActive && <span className="workspace-chip-item-check"><CheckIcon /></span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
