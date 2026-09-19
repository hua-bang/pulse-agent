import { useEffect, useState } from 'react';
import type { CanvasNode, FileNodeData } from '../../../../../types';
import { MarkdownPreview } from '../../../../chat/markdown';
import { useFilePersistence } from '../FileNodeBody/useFilePersistence';

interface Props {
  node: CanvasNode;
  readOnly: boolean;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void | Promise<void>;
  onContent: (content: string) => void;
  onError: () => void;
}

const ignoreModified = () => undefined;

/** Observe the file even in Library/detail surfaces without a Canvas watcher. */
export const PassiveFilePreview = ({ node, readOnly, onUpdate, onContent, onError }: Props) => {
  const data = node.data as FileNodeData;
  const [content, setContent] = useState(data.content ?? '');
  useEffect(() => { setContent(data.content ?? ''); }, [data.content, data.filePath, node.id]);
  useFilePersistence({
    nodeId: node.id,
    data,
    // This component never calls persistToFile. Read-only consumers still need
    // fresh visible bytes, but cannot publish changes to the node repository.
    readOnly: false,
    onUpdate: readOnly ? () => undefined : onUpdate,
    onReload: (next) => {
      setContent(next);
      onContent(next);
    },
    setModified: ignoreModified,
    onStatus: (state) => { if (state === 'error') onError(); },
  });
  return <MarkdownPreview content={content} softBreaks={false} />;
};
