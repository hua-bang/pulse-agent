import { useCallback, useState } from 'react';
import './App.css';
import { Canvas } from './components/Canvas';
import { Sidebar } from './components/Sidebar';
import { useWorkspaces } from './hooks/useWorkspaces';

const App = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [nodeCounts, setNodeCounts] = useState<Record<string, number>>({});

  const handleNodeCountChange = useCallback((canvasId: string, count: number) => {
    setNodeCounts(prev => {
      if (prev[canvasId] === count) return prev;
      return { ...prev, [canvasId]: count };
    });
  }, []);
  const {
    workspaces,
    folders,
    activeId,
    selectWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setRootFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolder,
    moveWorkspace,
    reorderFolder,
  } = useWorkspaces();

  return (
    <div className="app">
      <div className="app-body">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
          workspaces={workspaces}
          folders={folders}
          activeId={activeId}
          onSelect={selectWorkspace}
          onCreate={createWorkspace}
          onRename={renameWorkspace}
          onDelete={deleteWorkspace}
          onSetRootFolder={setRootFolder}
          onCreateFolder={createFolder}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
          onToggleFolder={toggleFolder}
          onMoveWorkspace={moveWorkspace}
          onReorderFolder={reorderFolder}
          nodeCounts={nodeCounts}
        />
        <div className="canvas-viewport">
          {workspaces.map((ws) => (
            <Canvas key={ws.id} canvasId={ws.id} canvasName={ws.name} rootFolder={ws.rootFolder} hidden={ws.id !== activeId} onNodeCountChange={handleNodeCountChange} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;
