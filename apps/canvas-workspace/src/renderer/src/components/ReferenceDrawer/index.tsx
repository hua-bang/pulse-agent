import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { Markdown } from 'tiptap-markdown';
import './index.css';
import type {
  AgentNodeData,
  CanvasNode,
  FileNodeData,
  FrameNodeData,
  IframeNodeData,
  ImageNodeData,
  MindmapNodeData,
  MindmapTopic,
  ShapeNodeData,
  TerminalNodeData,
  TextNodeData,
} from '../../types';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';

interface ReferenceDrawerProps {
  open: boolean;
  referenceNode?: CanvasNode;
  selectedNode?: CanvasNode;
  onOpenChange: (open: boolean) => void;
  onPinSelected: () => void;
  onClear: () => void;
  onFocusNode: (nodeId: string) => void;
}

export const ReferenceDrawer = ({
  open,
  referenceNode,
  selectedNode,
  onOpenChange,
  onPinSelected,
  onClear,
  onFocusNode,
}: ReferenceDrawerProps) => {
  const canPinSelected = Boolean(selectedNode);
  const selectedIsReference = Boolean(
    selectedNode && referenceNode && selectedNode.id === referenceNode.id,
  );

  if (!open) return null;

  return (
    <aside className="reference-drawer reference-drawer--open">
        <header className="reference-drawer-header">
          <div>
            <div className="reference-drawer-kicker">Pinned context</div>
            <h2>Reference</h2>
          </div>
          <button
            className="reference-drawer-icon-button"
            type="button"
            onClick={() => onOpenChange(false)}
            title="Close reference drawer"
            aria-label="Close reference drawer"
          >
            ×
          </button>
        </header>

        <div className="reference-drawer-actions">
          <button
            className="reference-drawer-primary"
            type="button"
            onClick={onPinSelected}
            disabled={!canPinSelected || selectedIsReference}
          >
            {referenceNode ? 'Replace with selected' : 'Pin selected node'}
          </button>
          {referenceNode && (
            <button className="reference-drawer-secondary" type="button" onClick={onClear}>
              Clear
            </button>
          )}
        </div>

        {!referenceNode ? (
          <ReferenceEmptyState selectedNode={selectedNode} />
        ) : (
          <div className={`reference-native-card reference-native-card--${referenceNode.type}`}>
            <div className="reference-native-header">
              <span className={`node-type-badge node-type-badge--${referenceNode.type}`}>
                {referenceNode.type}
              </span>
              <h3>{getNodeDisplayLabel(referenceNode)}</h3>
            </div>

            <ReferenceNodePreview node={referenceNode} />

            <div className="reference-card-footer">
              <button
                className="reference-drawer-secondary"
                type="button"
                onClick={() => onFocusNode(referenceNode.id)}
              >
                Focus on canvas
              </button>
            </div>
          </div>
        )}
    </aside>
  );
};

const ReferenceEmptyState = ({ selectedNode }: { selectedNode?: CanvasNode }) => (
  <div className="reference-empty">
    <div className="reference-empty-icon">⌑</div>
    <h3>No reference pinned</h3>
    <p>Select one node on the canvas, then pin it here as stable context while you work elsewhere.</p>
    {selectedNode ? (
      <div className="reference-selected-hint">
        <span>Selected</span>
        <strong>{getNodeDisplayLabel(selectedNode)}</strong>
      </div>
    ) : (
      <div className="reference-selected-hint reference-selected-hint--muted">
        Select a single node to enable pinning.
      </div>
    )}
  </div>
);

const ReferenceNodePreview = ({ node }: { node: CanvasNode }) => {
  switch (node.type) {
    case 'file': {
      const data = node.data as FileNodeData;
      return <ReferenceNotePreview content={data.content} emptyLabel="This note is empty." />;
    }
    case 'text': {
      const data = node.data as TextNodeData;
      return <ReferenceTextPreview data={data} />;
    }
    case 'terminal': {
      const data = node.data as TerminalNodeData;
      return <TextPreview content={data.scrollback} emptyLabel="No terminal scrollback yet." />;
    }
    case 'agent': {
      const data = node.data as AgentNodeData;
      return (
        <div className="reference-preview-stack">
          <PreviewMeta label="Agent" value={data.agentType} />
          <PreviewMeta label="Status" value={data.status ?? 'idle'} />
          <TextPreview content={data.scrollback} emptyLabel="No agent output yet." />
        </div>
      );
    }
    case 'iframe': {
      const data = node.data as IframeNodeData;
      return (
        <div className="reference-preview-stack">
          <PreviewMeta label="Mode" value={data.mode ?? 'url'} />
          <PreviewMeta label="URL" value={data.url || 'No URL'} />
          {data.html && <TextPreview content={data.html} emptyLabel="No HTML content." />}
        </div>
      );
    }
    case 'image': {
      const data = node.data as ImageNodeData;
      return data.filePath ? (
        <img className="reference-preview-image" src={`file://${data.filePath}`} alt={node.title} draggable={false} />
      ) : (
        <div className="reference-preview-empty">No image file.</div>
      );
    }
    case 'mindmap': {
      const data = node.data as MindmapNodeData;
      return <MindmapOutline root={data.root} />;
    }
    case 'frame': {
      const data = node.data as FrameNodeData;
      return <PreviewMeta label="Frame color" value={data.color} />;
    }
    case 'shape': {
      const data = node.data as ShapeNodeData;
      return (
        <div className="reference-preview-stack">
          <PreviewMeta label="Shape" value={data.kind} />
          {data.text && <TextPreview content={data.text} emptyLabel="No shape label." />}
        </div>
      );
    }
    default:
      return <div className="reference-preview-empty">Focus this node on canvas to inspect it.</div>;
  }
};

const ReferenceNotePreview = ({ content, emptyLabel }: { content?: string; emptyLabel: string }) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false }),
      Underline,
      Markdown.configure({ html: true, transformPastedText: false, breaks: true }),
    ],
    content: content || '',
    editable: false,
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(content || '', { emitUpdate: false });
  }, [editor, content]);

  if (!content?.trim()) return <div className="reference-preview-empty">{emptyLabel}</div>;

  return (
    <div className="reference-note-preview">
      <EditorContent editor={editor} className="note-tiptap-editor reference-note-editor" />
    </div>
  );
};

const ReferenceTextPreview = ({ data }: { data: TextNodeData }) => {
  if (!data.content?.trim()) {
    return <div className="reference-preview-empty">This text node is empty.</div>;
  }

  return (
    <div
      className="reference-text-preview"
      style={{
        color: data.textColor,
        backgroundColor: data.backgroundColor,
        fontSize: data.fontSize ?? 18,
      }}
      dangerouslySetInnerHTML={{ __html: data.content }}
    />
  );
};
const TextPreview = ({ content, emptyLabel }: { content?: string; emptyLabel: string }) => {
  const text = content?.trim();
  if (!text) return <div className="reference-preview-empty">{emptyLabel}</div>;
  return <pre className="reference-preview-text">{text}</pre>;
};

const PreviewMeta = ({ label, value }: { label: string; value: string }) => (
  <div className="reference-preview-meta">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const MindmapOutline = ({ root }: { root: MindmapTopic }) => (
  <div className="reference-mindmap-outline">
    <MindmapTopicItem topic={root} depth={0} />
  </div>
);

const MindmapTopicItem = ({ topic, depth }: { topic: MindmapTopic; depth: number }) => (
  <div className="reference-mindmap-topic" style={{ '--topic-depth': depth } as React.CSSProperties}>
    <div className="reference-mindmap-topic-label">
      <span />
      <strong>{topic.text || 'Untitled topic'}</strong>
    </div>
    {!topic.collapsed && topic.children.length > 0 && (
      <div className="reference-mindmap-children">
        {topic.children.map((child) => (
          <MindmapTopicItem key={child.id} topic={child} depth={depth + 1} />
        ))}
      </div>
    )}
  </div>
);
