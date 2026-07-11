import type { WorkspaceNodeListItem } from '../../types';
import { toFileUrl } from '../../utils/fileUrl';
import { ImageIcon, NodeTypeIcon } from '../icons';
import { getNodeSummary, truncateText } from './utils';

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

export type NodeCardPreviewModel =
  | FilePreviewModel
  | TextPreviewModel
  | WebPreviewModel
  | ImagePreviewModel
  | MindmapPreviewModel
  | GenericPreviewModel;

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

  switch (node.type) {
    case 'file': {
      const sections = previewSegments(summary, 3);
      return { kind: 'file', sections: sections.length > 0 ? sections : [emptyLabel] };
    }
    case 'text':
      return { kind: 'text', excerpt: summary ? truncateText(compactText(summary), 260) : emptyLabel };
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
      const branches = Array.from(new Set([...previewSegments(summary, 4), ...node.tags])).slice(0, 4);
      return { kind: 'mindmap', root: truncateText(title, 72), branches: branches.length > 0 ? branches : [emptyLabel] };
    }
    default:
      return { kind: 'generic', excerpt: summary ? truncateText(compactText(summary), 210) : emptyLabel };
  }
};

interface Props {
  node: WorkspaceNodeListItem;
  title: string;
  emptyLabel: string;
}

export const NodeCardPreview = ({ node, title, emptyLabel }: Props) => {
  const model = getNodeCardPreviewModel(node, title, emptyLabel);

  if (model.kind === 'file') {
    return (
      <span className="knowledge-card-preview knowledge-card-preview--file" data-preview-kind="file">
        {model.sections.map((section, index) => (
          <span className="knowledge-card-preview__file-row" key={`${index}:${section}`}>
            <span className="knowledge-card-preview__file-index" aria-hidden="true">{index + 1}</span>
            <span>{section}</span>
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
    return (
      <span className="knowledge-card-preview knowledge-card-preview--mindmap" data-preview-kind="mindmap">
        <span className="knowledge-card-preview__mindmap-root">
          <NodeTypeIcon type="mindmap" size={15} />
          <span>{model.root}</span>
        </span>
        <span className="knowledge-card-preview__mindmap-branches">
          {model.branches.map((branch) => <span key={branch}>{truncateText(branch, 44)}</span>)}
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
