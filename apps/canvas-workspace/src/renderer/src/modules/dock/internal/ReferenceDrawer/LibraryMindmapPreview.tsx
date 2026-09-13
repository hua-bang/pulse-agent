import { useEffect, useMemo, useState } from 'react';
import type { MindmapTopic } from '../../../../types';
import { layoutMindmap } from '../../../canvas';
import { useI18n } from '../../../../i18n';
import type { LibraryItem } from './libraryModel';

/** Lightweight, read-only SVG shared by the card thumbnail and detail view. */
export const LibraryMindmapPreview = ({ item, root: suppliedRoot, detail = false }: {
  item?: LibraryItem; root?: MindmapTopic; detail?: boolean;
}) => {
  const { t } = useI18n();
  const root = suppliedRoot || item?.mindmapRoot;
  const [loaded, setLoaded] = useState<MindmapTopic>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoaded(undefined); setFailed(false);
    if (root || item?.entry.kind !== 'node') return;
    let cancelled = false;
    const { workspaceId, nodeId } = item.entry;
    void window.canvasWorkspace.workspaceNodes.read(workspaceId, nodeId).then(result => {
      if (cancelled) return;
      if (result.ok && result.node?.type === 'mindmap' && result.node.data.root) setLoaded(result.node.data.root as MindmapTopic);
      else setFailed(true);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [root, item?.id]);
  const tree = root || loaded;
  const layout = useMemo(() => tree ? layoutMindmap(tree) : null, [tree]);
  if (!layout) return <span className="library-mindmap-placeholder">{t(failed ? 'reference.sourceMissing' : 'reference.libraryLoading')}</span>;
  return <svg className={`library-mindmap-preview${detail ? ' library-mindmap-preview--detail' : ''}`}
    viewBox={`-24 -24 ${layout.width + 48} ${layout.height + 48}`} preserveAspectRatio="xMidYMid meet"
    role="img" aria-label={tree?.text || t('reference.libraryKind.mindmap')}>
    {layout.branches.map(branch => <path key={branch.id} d={branch.path} stroke={branch.color} strokeWidth={2} fill="none" />)}
    {layout.topics.map(topic => <foreignObject key={topic.id} x={topic.x} y={topic.y} width={topic.width} height={topic.height}>
      <div className="library-mindmap-label" style={{ fontSize: topic.depth === 0 ? 18 : 14, fontWeight: topic.depth === 0 ? 600 : 400 }}>{topic.text}</div>
    </foreignObject>)}
  </svg>;
};
