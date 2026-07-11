import type { ReactNode } from 'react';
import { Button } from '../ui/Button';

export type KnowledgeCardKind = 'file' | 'text' | 'iframe' | 'image' | 'mindmap' | 'generic';

interface Props {
  kind: KnowledgeCardKind;
  selected: boolean;
  openLabel: string;
  onOpen: (trigger: HTMLButtonElement) => void;
  children: ReactNode;
}

export const CardShell = ({ kind, selected, openLabel, onOpen, children }: Props) => (
  <article className={`knowledge-node-card knowledge-node-card--${kind}${selected ? ' is-selected' : ''}`}>
    <Button
      className="knowledge-node-card__button"
      aria-label={openLabel}
      aria-current={selected ? 'true' : undefined}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {children}
    </Button>
  </article>
);
