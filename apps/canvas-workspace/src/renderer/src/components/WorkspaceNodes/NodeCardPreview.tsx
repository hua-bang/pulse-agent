import type { CSSProperties } from 'react';
import type { WorkspaceNodeListItem } from '../../types';
import { toFileUrl } from '../../utils/fileUrl';
import { ImageIcon, NodeTypeIcon, SparklesIcon } from '../icons';
import { getNodeAiSummary, getNodeSummary, truncateText } from './utils';

interface AiSummaryPreviewModel {
  kind: 'ai-summary';
  excerpt: string;
  source?: string;
}

interface FilePreviewModel {
  kind: 'file';
  sections: string[];
}

interface TextPreviewModel {
  kind: 'text';
  excerpt: string;
}

interface WebPreviewModel {
  kind: 'iframe';
  source: string;
  excerpt: string;
}

interface ImagePreviewModel {
  kind: 'image';
  caption: string;
  src?: string;
}

interface MindmapPreviewModel {
  kind: 'mindmap';
  root: string;
  branches: string[];
}

interface GenericPreviewModel {
  kind: 'generic';
  excerpt: string;
}

interface EmptyPreviewModel {
  kind: 'empty';
}

export type NodeCardPreviewModel =
  | AiSummaryPreviewModel
  | FilePreviewModel
  | TextPreviewModel
  | WebPreviewModel
  | ImagePreviewModel
  | MindmapPreviewModel
  | GenericPreviewModel
  | EmptyPreviewModel;

const compactText = (value: string): string => value.replace(/\s+/g, ' ').trim();
const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s)\]}]+/gi;

const previewSegments = (value: string, limit: number): string[] => {
  const segments = value
    .split(/[\n\r]+|[。！？；!?;]+|\.\s+/u)
    .map((segment) => compactText(segment.replace(/^\s*(?:[-*#>]|\d+[.)])\s*/, '')))
    .filter(Boolean);

  const unique = Array.from(new Set(segments));
  return unique.slice(0, limit).map((segment) => truncateText(segment, 76));
};

const findWebSource = (node: WorkspaceNodeListItem, summary: string): string => {
  const candidate = `${summary} ${node.title ?? ''}`.match(URL_PATTERN)?.[0];
  if (!candidate) return node.workspaceName ?? node.type;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'file:') {
      const fileName = url.pathname.split('/').filter(Boolean).at(-1);
      return fileName ? decodeURIComponent(fileName) : node.title ?? node.type;
    }
    return url.hostname.replace(/^www\./, '');
  } catch {
    return candidate;
  }
};

const webExcerpt = (summary: string, emptyLabel: string): string => {
  const withoutUrl = summary.replace(URL_PATTERN, '');
  const compact = compactText(withoutUrl);
  return compact ? truncateText(compact, 190) : emptyLabel;
};

/**
 * Builds the card preview solely from `WorkspaceNodeListItem`. This is the
 * list-surface seam: it must stay lightweight and must not fetch or hydrate a
 * full workspace node record just to paint the masonry view.
 */
export const getNodeCardPreviewModel = (
  node: WorkspaceNodeListItem,
  title: string,
  emptyLabel: string,
): NodeCardPreviewModel => {
  const summary = getNodeSummary(node);
  const aiSummary = getNodeAiSummary(node);

  if (aiSummary) {
    return {
      kind: 'ai-summary',
      excerpt: truncateText(aiSummary, 260),
      ...(node.type === 'iframe' ? { source: findWebSource(node, summary) } : {}),
    };
  }

  switch (node.type) {
    case 'file': {
      const sections = previewSegments(summary, 3);
      return sections.length > 0 ? { kind: 'file', sections } : { kind: 'empty' };
    }
    case 'text':
      return summary
        ? { kind: 'text', excerpt: truncateText(compactText(summary), 260) }
        : { kind: 'empty' };
    case 'iframe':
      return {
        kind: 'iframe',
        source: findWebSource(node, summary),
        excerpt: webExcerpt(summary, emptyLabel),
      };
    case 'image':
      return {
        kind: 'image',
        caption: summary ? truncateText(compactText(summary), 110) : emptyLabel,
        src: node.previewPath ? toFileUrl(node.previewPath) : undefined,
      };
    case 'mindmap': {
      const root = compactText(node.mindmapPreview?.root ?? title);
      const branches = node.mindmapPreview?.branches ?? [];
      return root ? { kind: 'mindmap', root: truncateText(root, 72), branches } : { kind: 'empty' };
    }
    default:
      return summary
        ? { kind: 'generic', excerpt: truncateText(compactText(summary), 210) }
        : { kind: 'empty' };
  }
};

interface Props {
  node: WorkspaceNodeListItem;
  title: string;
  emptyLabel: string;
  aiSummaryLabel?: string;
  confirmedLabel?: string;
}

export const NodeCardPreview = ({
  node,
  title,
  emptyLabel,
  aiSummaryLabel = 'AI insight',
  confirmedLabel = 'Confirmed',
}: Props) => {
  const model = getNodeCardPreviewModel(node, title, emptyLabel);

  if (model.kind === 'empty') return null;

  if (model.kind === 'ai-summary') {
    return (
      <span className="knowledge-card-preview knowledge-card-preview--ai-summary" data-preview-kind="ai-summary">
        <span className="knowledge-card-preview__ai-summary-label">
          <span><SparklesIcon size={13} />{aiSummaryLabel}</span>
          <span>{confirmedLabel}</span>
        </span>
        <span className="knowledge-card-preview__ai-summary-copy">{model.excerpt}</span>
        {model.source && <span className="knowledge-card-preview__ai-summary-source">{model.source}</span>}
      </span>
    );
  }

  if (model.kind === 'file') {
    return (
      <span className="knowledge-card-preview knowledge-card-preview--file" data-preview-kind="file">
        {model.sections.map((section) => (
          <span className="knowledge-card-preview__file-row" key={section}>
            {section}
          </span>
        ))}
      </span>
    );
  }

  if (model.kind === 'text') {
    return (
      <span className="knowledge-card-preview knowledge-card-preview--text" data-preview-kind="text">
        <span className="knowledge-card-preview__quote" aria-hidden="true">“</span>
        <span>{model.excerpt}</span>
      </span>
    );
  }

  if (model.kind === 'iframe') {
    return (
      <span className="knowledge-card-preview knowledge-card-preview--web" data-preview-kind="iframe">
        <span className="knowledge-card-preview__web-source">
          <NodeTypeIcon type="iframe" size={15} />
          <span>{model.source}</span>
          <span aria-hidden="true">↗</span>
        </span>
        <span className="knowledge-card-preview__web-copy">{model.excerpt}</span>
      </span>
    );
  }

  if (model.kind === 'image') {
    return (
      <span className="knowledge-card-preview knowledge-card-preview--image" data-preview-kind="image">
        <span className="knowledge-card-preview__image-field" aria-hidden="true">
          <ImageIcon size={22} />
          <span className="knowledge-card-preview__image-horizon" />
          {model.src && (
            <img
              src={model.src}
              alt=""
              loading="lazy"
              decoding="async"
              onError={(event) => { event.currentTarget.hidden = true; }}
            />
          )}
        </span>
        <span className="knowledge-card-preview__image-caption">{model.caption}</span>
      </span>
    );
  }

  if (model.kind === 'mindmap') {
    const count = model.branches.length;
    return (
      <span className="knowledge-card-preview knowledge-card-preview--mindmap" data-preview-kind="mindmap">
        <svg className="knowledge-card-preview__mindmap-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {model.branches.map((branch, index) => {
            const y = count <= 1 ? 50 : 16 + (index * 68) / (count - 1);
            return <path key={branch} d={`M 38 50 C 52 50 57 ${y} 66 ${y}`} />;
          })}
        </svg>
        <span className="knowledge-card-preview__mindmap-root">
          <NodeTypeIcon type="mindmap" size={14} />
          <span>{model.root}</span>
        </span>
        <span className="knowledge-card-preview__mindmap-branches">
          {model.branches.map((branch, index) => {
            const y = count <= 1 ? 50 : 16 + (index * 68) / (count - 1);
            return <span key={branch} style={{ '--mindmap-y': `${y}%` } as CSSProperties}>{truncateText(branch, 44)}</span>;
          })}
        </span>
      </span>
    );
  }

  return (
    <span className="knowledge-card-preview knowledge-card-preview--generic" data-preview-kind="generic">
      {model.excerpt}
    </span>
  );
};
