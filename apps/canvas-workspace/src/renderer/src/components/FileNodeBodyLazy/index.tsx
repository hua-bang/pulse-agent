import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react';
import type { CanvasNode, FileNodeData } from '../../types';
import { dispatchOpenNode, parseNodeLinkHref } from '../../utils/openNodeBridge';
import { useRightDock } from '../RightDock';
import './index.css';

interface Props {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void | Promise<void>;
  workspaceId?: string;
  getAllNodes?: () => CanvasNode[];
  readOnly?: boolean;
  eager?: boolean;
  syncLeadingHeadingTitle?: boolean;
}

const FileNodeEditor = lazy(() =>
  import('../FileNodeBody').then((module) => ({ default: module.FileNodeBody })),
);

const renderInline = (text: string): ReactNode[] => {
  const parts = text.split(/(`[^`]+`|!?\[[^\]]*\]\([^)]+\))/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    const match = part.match(/^(!?)\[([^\]]*)\]\(([^)]+)\)$/);
    if (!match) return part;
    if (match[1]) return <span key={index} className="file-preview__image">🖼 {match[2] || 'Image'}</span>;
    return <a key={index} href={match[3]}>{match[2] || match[3]}</a>;
  });
};

export const MarkdownPreview = ({ content }: { content: string }) => {
  const rows: ReactNode[] = [];
  let inCode = false;
  let code: string[] = [];
  const flushCode = () => {
    if (code.length > 0) rows.push(<pre key={`code-${rows.length}`}><code>{code.join('\n')}</code></pre>);
    code = [];
  };

  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const Tag = `h${heading[1].length}` as 'h1' | 'h2' | 'h3' | 'h4';
      rows.push(<Tag key={rows.length}>{renderInline(heading[2])}</Tag>);
      continue;
    }
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (task) {
      rows.push(<div key={rows.length} className="file-preview__list">{task[1] === ' ' ? '☐' : '☑'} {renderInline(task[2])}</div>);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      rows.push(<div key={rows.length} className="file-preview__list">• {renderInline(bullet[1])}</div>);
      continue;
    }
    if (line.trim()) rows.push(<p key={rows.length}>{renderInline(line)}</p>);
  }
  if (inCode) flushCode();
  return <>{rows}</>;
};

export const FileNodeBodyLazy = (props: Props) => {
  const [editorLoaded, setEditorLoaded] = useState(props.eager ?? false);
  const { openLink } = useRightDock();
  const content = (props.node.data as FileNodeData).content ?? '';
  const activateEditor = useCallback(() => {
    if (!props.readOnly) setEditorLoaded(true);
  }, [props.readOnly]);
  const handlePreviewClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest?.('a');
    const href = anchor?.getAttribute('href')?.trim();
    if (!href) {
      activateEditor();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nodeLink = parseNodeLinkHref(href);
    if (nodeLink) {
      dispatchOpenNode({ workspaceId: nodeLink.workspaceId ?? props.workspaceId ?? '', nodeId: nodeLink.nodeId });
    } else if (/^https?:\/\//i.test(href)) {
      openLink(href);
    }
  }, [activateEditor, openLink, props.workspaceId]);

  if (editorLoaded) {
    return (
      <Suspense fallback={<div className="file-preview file-preview--loading"><MarkdownPreview content={content} /></div>}>
        <FileNodeEditor {...props} autoFocus={!props.eager} />
      </Suspense>
    );
  }

  return (
    <div
      className={`file-preview${props.readOnly ? '' : ' file-preview--editable'}`}
      onClick={handlePreviewClick}
      onKeyDown={(event) => { if (event.key === 'Enter') activateEditor(); }}
      tabIndex={props.readOnly ? undefined : 0}
      aria-label={props.readOnly ? undefined : 'Edit note'}
    >
      <MarkdownPreview content={content} />
    </div>
  );
};
