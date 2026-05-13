import type { MouseEvent } from 'react';
import type { ArtifactNodeData, ArtifactWidget } from '../../types';
import './index.css';

interface ArtifactNodeBodyProps {
  data: ArtifactNodeData;
  onCopyMarkdown?: () => void;
  onRegenerate?: () => void;
}

const escapeCell = (value: string | number | boolean | null | undefined): string => {
  const text = value == null ? '' : String(value);
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
};

export const artifactToMarkdown = (title: string, data: ArtifactNodeData): string => {
  const lines: string[] = [`# ${title}`, ''];
  if (data.summary) {
    lines.push(data.summary, '');
  }

  for (const widget of data.widgets) {
    switch (widget.type) {
      case 'heading':
        lines.push(`${'#'.repeat(Math.min(Math.max(widget.level ?? 2, 1), 4))} ${widget.text}`, '');
        break;
      case 'paragraph':
        lines.push(widget.text, '');
        break;
      case 'callout':
        lines.push(`> **${widget.tone ?? 'note'}** ${widget.title ? `${widget.title}: ` : ''}${widget.text}`, '');
        break;
      case 'list':
        for (const item of widget.items) {
          const mark = widget.ordered ? '1.' : widget.checklist ? (item.checked ? '- [x]' : '- [ ]') : '-';
          lines.push(`${mark} ${item.text}`);
        }
        lines.push('');
        break;
      case 'table': {
        const headers = widget.columns.map(escapeCell);
        lines.push(`| ${headers.join(' | ')} |`);
        lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
        for (const row of widget.rows) {
          lines.push(`| ${widget.columns.map((column) => escapeCell(row[column])).join(' | ')} |`);
        }
        lines.push('');
        break;
      }
      case 'stats':
        for (const stat of widget.items) {
          lines.push(`- **${stat.label}:** ${stat.value}${stat.caption ? ` — ${stat.caption}` : ''}`);
        }
        lines.push('');
        break;
      case 'code':
        lines.push(`\`\`\`${widget.language ?? ''}`, widget.code, '```', '');
        break;
    }
  }

  if (data.sources?.length) {
    lines.push('---', `Generated from ${data.sources.map((source) => `@${source.title}`).join(', ')}`);
  }
  if (data.generatedAt) {
    lines.push(`Generated at ${new Date(data.generatedAt).toLocaleString()}`);
  }
  return lines.join('\n').trimEnd();
};

const stop = (event: MouseEvent) => event.stopPropagation();

const WidgetRenderer = ({ widget }: { widget: ArtifactWidget }) => {
  switch (widget.type) {
    case 'heading': {
      const Tag = (`h${Math.min(Math.max(widget.level ?? 2, 1), 4)}` as keyof JSX.IntrinsicElements);
      return <Tag className="artifact-heading">{widget.text}</Tag>;
    }
    case 'paragraph':
      return <p className="artifact-paragraph">{widget.text}</p>;
    case 'callout':
      return (
        <div className={`artifact-callout artifact-callout--${widget.tone ?? 'info'}`}>
          {widget.title ? <div className="artifact-callout-title">{widget.title}</div> : null}
          <div className="artifact-callout-text">{widget.text}</div>
        </div>
      );
    case 'list':
      return widget.ordered ? (
        <ol className="artifact-list artifact-list--ordered">
          {widget.items.map((item, index) => <li key={index}>{item.text}</li>)}
        </ol>
      ) : (
        <ul className={`artifact-list ${widget.checklist ? 'artifact-list--checklist' : ''}`}>
          {widget.items.map((item, index) => (
            <li key={index}>
              {widget.checklist ? <span className={`artifact-check ${item.checked ? 'artifact-check--done' : ''}`}>{item.checked ? '✓' : ''}</span> : null}
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="artifact-table-wrap">
          <table className="artifact-table">
            <thead>
              <tr>{widget.columns.map((column) => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {widget.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {widget.columns.map((column) => <td key={column}>{String(row[column] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'stats':
      return (
        <div className="artifact-stats">
          {widget.items.map((stat, index) => (
            <div className="artifact-stat" key={index}>
              <div className="artifact-stat-value">{stat.value}</div>
              <div className="artifact-stat-label">{stat.label}</div>
              {stat.caption ? <div className="artifact-stat-caption">{stat.caption}</div> : null}
            </div>
          ))}
        </div>
      );
    case 'code':
      return (
        <pre className="artifact-code"><code>{widget.code}</code></pre>
      );
  }
};

export const ArtifactNodeBody = ({ data, onCopyMarkdown, onRegenerate }: ArtifactNodeBodyProps) => {
  return (
    <div className="artifact-node-body" onMouseDown={stop}>
      <div className="artifact-toolbar">
        <span className="artifact-badge">AI Artifact</span>
        <div className="artifact-actions">
          {onRegenerate ? <button type="button" onClick={onRegenerate} title="Regenerate from original prompt">⟳</button> : null}
          {onCopyMarkdown ? <button type="button" onClick={onCopyMarkdown} title="Copy as Markdown">⎘</button> : null}
        </div>
      </div>
      {data.summary ? <p className="artifact-summary">{data.summary}</p> : null}
      <div className="artifact-widgets">
        {data.widgets.map((widget, index) => <WidgetRenderer widget={widget} key={index} />)}
      </div>
      <div className="artifact-footer">
        {data.sources?.length ? <span>Generated from {data.sources.map((source) => `@${source.title}`).join(', ')}</span> : <span>Generated artifact</span>}
        {data.generatedAt ? <span> · {new Date(data.generatedAt).toLocaleString()}</span> : null}
      </div>
    </div>
  );
};
