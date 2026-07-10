import type { ReactNode } from 'react';
import './index.css';

interface Props {
  /** Optional leading icon/illustration. Rendered as-is — size, background
   *  tile, and color stay with the caller (see ReferenceEmptyState's own
   *  `.reference-empty-icon`, kept in its own CSS). */
  icon?: ReactNode;
  /** Primary heading. */
  title: ReactNode;
  /** Supporting copy under the title. Omit when there's nothing more to
   *  say (see ChatEmptyState's SKIP verdict in docs/ui-reuse-burndown.md —
   *  it has no description at all, among other misfits). */
  description?: ReactNode;
  /** Optional trailing slot — a hint block, a CTA, or any composed
   *  follow-up content. */
  action?: ReactNode;
  /** Extra class on the root wrapper. This is how per-surface alignment,
   *  border, background, and padding stay with the caller — e.g.
   *  ReferenceEmptyState's centered bordered card vs. LayersPanel's
   *  left-aligned dashed hint box both layer their own class on top of
   *  this shell's bare layout. */
  className?: string;
}

/**
 * ui/EmptyState — the blessed MINIMAL empty-state shell: layout/spacing for
 * an optional icon, a title, an optional description, and an optional
 * trailing slot. Business copy, illustrations, and per-surface decorative
 * styling (border, background, alignment) stay with callers — this piece
 * only owns the vertical stack and the title/description typography.
 *
 * The root uses `display:flex; flex-direction:column` with NO forced
 * `align-items`/`text-align` — flex's default `stretch` makes every child
 * (icon/title/description/action) a full-width block, so a caller's own
 * `text-align:center` (ReferenceEmptyState) or the browser default `left`
 * (LayersPanel, which sets neither) both fall out of that one shared
 * layout with zero extra override CSS. An icon with its own explicit
 * width/height (e.g. `margin: 0 auto` + a fixed size, as
 * `.reference-empty-icon` already does) self-centers regardless, since an
 * explicit size wins over `stretch` per the flexbox spec.
 *
 * Migrated: `ReferenceDrawer/ReferenceEmptyState.tsx` (icon + title +
 * description + a conditional hint block as `action`) and
 * `Sidebar/LayersPanel.tsx`'s `sidebar-layers-empty` block (title +
 * description only, no icon — a real second call site, previously
 * duplicated as its own `strong`/`span` pair). SKIPPED, with verdicts, in
 * docs/ui-reuse-burndown.md: `chat/ChatEmptyState.tsx` (no description; a
 * dominant, bottom-anchored quick-actions list is the real content, not an
 * appendage) and `CanvasEmptyHint/index.tsx` (only its preamble matches —
 * everything below is a bespoke action-grid/form, and it wasn't one of the
 * two evidence sites named for this batch).
 */
export const EmptyState = ({ icon, title, description, action, className }: Props) => {
  const classes = ['ui-emptystate', className].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      {icon != null && <div className="ui-emptystate__icon">{icon}</div>}
      <div className="ui-emptystate__title">{title}</div>
      {description != null && <div className="ui-emptystate__desc">{description}</div>}
      {action != null && <div className="ui-emptystate__action">{action}</div>}
    </div>
  );
};
