import type { ReactNode } from 'react';
import { Button } from '../ui/Button';

export type KnowledgeCardKind = 'file' | 'text' | 'iframe' | 'image' | 'mindmap' | 'generic';

interface Props {
  kind: KnowledgeCardKind;
  selected: boolean;
  contextSelected?: boolean;
  openLabel: string;
  onOpen: (trigger: HTMLButtonElement) => void;
  actions?: ReactNode;
  children: ReactNode;
}

export const CardShell = ({ kind, selected, contextSelected = false, openLabel, onOpen, actions, children }: Props) => (
  <article className={`knowledge-node-card knowledge-node-card--${kind}${selected ? ' is-selected' : ''}${contextSelected ? ' is-context-selected' : ''}`}>
    <Button
      className="knowledge-node-card__button"
      aria-label={openLabel}
      aria-current={selected ? 'true' : undefined}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {children}
    </Button>
    {actions && <div className="knowledge-node-card__actions">{actions}</div>}
  </article>
);
