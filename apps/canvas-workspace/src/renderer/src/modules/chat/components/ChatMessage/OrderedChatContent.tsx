import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgentChatContentBlock } from '../../../../../../shared/agent-chat';
import { groupContentBlocks } from '../../../../../../shared/chat-content-blocks';
import type { CanvasNode, ToolCallStatus } from '../../../../types';
import { useRoleColors, useRoleNameColors } from '../../mentions/roleMentionItems';
import { renderMdWithMentions } from '../utils/mentions';
import { renderMermaidIn } from '../../../../utils/mermaid';
import { MarkdownContent } from './MarkdownContent';

interface Props {
  blocks: AgentChatContentBlock[];
  tools: ToolCallStatus[];
  streaming: boolean;
  nodes?: CanvasNode[];
  rootFolder?: string;
  renderTools: (tools: ToolCallStatus[], collapsed: boolean, toggle: () => void) => ReactNode;
}

function TextBlock({ text, streaming, nodes, rootFolder }: {
  text: string;
  streaming: boolean;
  nodes?: CanvasNode[];
  rootFolder?: string;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const roleColors = useRoleColors();
  const roleNames = useRoleNameColors();
  const html = useMemo(() => renderMdWithMentions(text, nodes, {
    streaming, rootFolder, roleColors, roleNames,
  }), [text, nodes, streaming, rootFolder, roleColors, roleNames]);
  useEffect(() => {
    if (!streaming) renderMermaidIn(bodyRef.current);
  }, [html, streaming]);
  return <MarkdownContent imagePreview bodyRef={bodyRef} html={html} streaming={streaming} />;
}

function ToolGroup({ tools, renderTools }: Pick<Props, 'tools' | 'renderTools'>) {
  const [collapsed, setCollapsed] = useState(true);
  return <>{renderTools(tools, collapsed, () => setCollapsed(value => !value))}</>;
}

export function OrderedChatContent({ blocks, tools, streaming, nodes, rootFolder, renderTools }: Props) {
  const groups = groupContentBlocks(blocks, tools);
  return <div className="chat-ordered-content">
    {groups.map((group, index) => group.type === 'text' ? (
      <TextBlock
        key={`text-${index}`}
        text={group.text}
        streaming={streaming && index === groups.length - 1}
        nodes={nodes}
        rootFolder={rootFolder}
      />
    ) : (
      <ToolGroup key={`tools-${index}`} tools={group.tools} renderTools={renderTools} />
    ))}
  </div>;
}
