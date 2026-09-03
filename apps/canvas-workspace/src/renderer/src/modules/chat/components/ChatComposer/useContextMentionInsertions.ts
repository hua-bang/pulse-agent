import { useCallback, type RefObject } from 'react';
import type { AgentContextDomSelectionRef, AgentContextTabRef, CanvasNode } from '../../../../types';
import { getNodeDisplayLabel } from '../../../../utils/nodeLabel';
import type { MentionItem } from '../../../../types';
import { appendMentionChipToEditable } from '../utils/editableMentions';
import { createMentionChipElement, serializeEditable } from '../utils/mentions';

interface Options {
  editableRef: RefObject<HTMLDivElement>;
  nodes?: CanvasNode[];
  workspaceId?: string;
  setInput: (value: string) => void;
  describeTab: (tab: AgentContextTabRef) => string;
}

export const useContextMentionInsertions = ({
  editableRef,
  nodes,
  workspaceId,
  setInput,
  describeTab,
}: Options) => {
  const appendItem = useCallback((item: MentionItem) => {
    const element = editableRef.current;
    if (!element) return;
    appendMentionChipToEditable(element, createMentionChipElement(item, nodes));
    setInput(serializeEditable(element));
    element.focus();
  }, [editableRef, nodes, setInput]);

  const insertNodeMention = useCallback((node: CanvasNode, sourceWorkspaceId?: string) => {
    appendItem({
      type: 'node',
      nodeId: node.id,
      label: getNodeDisplayLabel(node),
      nodeType: node.type,
      path: (node.data as { filePath?: string })?.filePath,
      ...(sourceWorkspaceId && sourceWorkspaceId !== workspaceId
        ? { workspaceId: sourceWorkspaceId }
        : {}),
    });
  }, [appendItem, workspaceId]);

  const insertDomSelectionMention = useCallback((domSelection: AgentContextDomSelectionRef) => {
    appendItem({
      type: 'dom',
      label: domSelection.label,
      nodeType: 'iframe',
      domSelection,
    });
  }, [appendItem]);

  const insertTabMention = useCallback((tab: AgentContextTabRef) => {
    appendItem({
      type: 'tab',
      label: tab.title || tab.url || tab.kind,
      description: describeTab(tab),
      tab,
    });
  }, [appendItem, describeTab]);

  return { insertNodeMention, insertDomSelectionMention, insertTabMention };
};
