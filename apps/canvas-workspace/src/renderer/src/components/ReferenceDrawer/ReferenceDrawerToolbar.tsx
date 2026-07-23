import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { CanvasNode } from '../../types';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { ReferencePickerMode, ReferencePickerNodeGroup } from './types';
import { ArtifactsPicker } from './ArtifactsPicker';
import { ReferencePicker } from './ReferencePicker';
import { ReferenceUrlEditor } from './ReferenceUrlEditor';

interface ReferenceDrawerToolbarProps {
  activeWorkspaceId: string;
  onPreviewArtifact: Parameters<typeof ArtifactsPicker>[0]['onPreviewArtifact'];
  allNodes: Record<string, CanvasNode[]>;
  currentNodeCount: number;
  externalWorkspaceId?: string;
  externalWorkspaces: WorkspaceEntry[];
  handleAddFromPicker: (nodeId: string) => void;
  handleAddUrl: () => void;
  pickerOpen: ReferencePickerMode | null;
  pickerRef: RefObject<HTMLDivElement>;
  pickableNodeGroups: ReferencePickerNodeGroup[];
  pickableNodes: CanvasNode[];
  searchActive: boolean;
  searchDraft: string;
  setExternalWorkspaceId: (workspaceId: string | undefined) => void;
  setPickerOpen: Dispatch<SetStateAction<ReferencePickerMode | null>>;
  setSearchDraft: (value: string) => void;
  setUrlDraft: (value: string) => void;
  setUrlEditorOpen: Dispatch<SetStateAction<boolean>>;
  setUrlError: (value: string | undefined) => void;
  urlDraft: string;
  urlEditorOpen: boolean;
  urlEditorRef: RefObject<HTMLDivElement>;
  urlError?: string;
  workspaceNameById: Map<string, string>;
}

export const ReferenceDrawerToolbar = ({
  activeWorkspaceId,
  onPreviewArtifact,
  allNodes,
  currentNodeCount,
  externalWorkspaceId,
  externalWorkspaces,
  handleAddFromPicker,
  handleAddUrl,
  pickerOpen,
  pickerRef,
  pickableNodeGroups,
  pickableNodes,
  searchActive,
  searchDraft,
  setExternalWorkspaceId,
  setPickerOpen,
  setSearchDraft,
  setUrlDraft,
  setUrlEditorOpen,
  setUrlError,
  urlDraft,
  urlEditorOpen,
  urlEditorRef,
  urlError,
  workspaceNameById,
}: ReferenceDrawerToolbarProps) => (
  <div className="reference-drawer-toolbar">
    <ReferencePicker
      allNodes={allNodes}
      currentNodeCount={currentNodeCount}
      externalWorkspaceId={externalWorkspaceId}
      externalWorkspaces={externalWorkspaces}
      pickerOpen={pickerOpen}
      pickerRef={pickerRef}
      pickableNodeGroups={pickableNodeGroups}
      pickableNodes={pickableNodes}
      searchActive={searchActive}
      searchDraft={searchDraft}
      setExternalWorkspaceId={setExternalWorkspaceId}
      setPickerOpen={setPickerOpen}
      setSearchDraft={setSearchDraft}
      workspaceNameById={workspaceNameById}
      onPick={handleAddFromPicker}
    />

    <ArtifactsPicker
      activeWorkspaceId={activeWorkspaceId}
      workspaceNameById={workspaceNameById}
      onPreviewArtifact={onPreviewArtifact}
    />

    <ReferenceUrlEditor
      handleAddUrl={handleAddUrl}
      setUrlDraft={setUrlDraft}
      setUrlEditorOpen={setUrlEditorOpen}
      setUrlError={setUrlError}
      urlDraft={urlDraft}
      urlEditorOpen={urlEditorOpen}
      urlEditorRef={urlEditorRef}
      urlError={urlError}
    />
  </div>
);
