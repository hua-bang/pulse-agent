/**
 * Find bar for a web tab — the ⌘/Ctrl+F surface. Chromium runs the search in
 * the guest (see `useFindInPage`); this is only the query box, the match
 * counter and the step controls.
 */
import type { KeyboardEvent, RefObject } from 'react';
import { useI18n } from '../../../i18n';
import { Button, TextField } from '../../ui';
import type { FindMatches } from './useFindInPage';

interface Props {
  query: string;
  matches: FindMatches;
  /** Wrapper ref — `useFindInPage` focuses the control through it. */
  barRef: RefObject<HTMLDivElement>;
  onQueryChange: (query: string) => void;
  onStep: (forward: boolean) => void;
  onClose: () => void;
}

export const FindInPageBar = ({ query, matches, barRef, onQueryChange, onStep, onClose }: Props) => {
  const { t } = useI18n();
  const hasQuery = query.trim().length > 0;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      // Claim it here: the dock's window-level Escape would otherwise act on
      // the tab itself while the user is only trying to dismiss this bar.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onStep(!event.shiftKey);
  };

  return (
    <div className="link-drawer__find" role="search" ref={barRef}>
      <TextField
        className="link-drawer__find-input"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('linkDrawer.find.placeholder')}
        aria-label={t('linkDrawer.find.placeholder')}
        spellCheck={false}
      />
      <span
        className="link-drawer__find-count"
        role="status"
        data-empty={hasQuery && matches.total === 0}
      >
        {hasQuery
          ? t('linkDrawer.find.count', {
            active: String(matches.active),
            total: String(matches.total),
          })
          : ''}
      </span>
      <Button
        variant="icon"
        size="xs"
        onClick={() => onStep(false)}
        disabled={matches.total === 0}
        title={t('linkDrawer.find.previous')}
        aria-label={t('linkDrawer.find.previous')}
      >
        ‹
      </Button>
      <Button
        variant="icon"
        size="xs"
        onClick={() => onStep(true)}
        disabled={matches.total === 0}
        title={t('linkDrawer.find.next')}
        aria-label={t('linkDrawer.find.next')}
      >
        ›
      </Button>
      <Button
        variant="icon"
        size="xs"
        onClick={onClose}
        title={t('linkDrawer.find.close')}
        aria-label={t('linkDrawer.find.close')}
      >
        ×
      </Button>
    </div>
  );
};
