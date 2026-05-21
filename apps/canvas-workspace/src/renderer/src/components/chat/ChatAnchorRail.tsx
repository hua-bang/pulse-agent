import type { ChatAnchor } from './utils/anchors';

interface ChatAnchorRailProps {
  anchors: ChatAnchor[];
  activeIndex: number | null;
  onJump: (index: number) => void;
}

/**
 * Ambient anchor rail — a thin vertical strip of dots glued to the left
 * edge of the messages area. Each dot maps to one user message; the
 * active dot tracks the user's current scroll position.
 */
export const ChatAnchorRail = ({ anchors, activeIndex, onJump }: ChatAnchorRailProps) => {
  if (anchors.length === 0) return null;
  return (
    <div className="chat-anchor-rail" aria-hidden="false">
      {anchors.map((anchor, i) => {
        const active = activeIndex === anchor.index;
        return (
          <button
            key={anchor.index}
            type="button"
            className={`chat-anchor-rail-dot${active ? ' chat-anchor-rail-dot--active' : ''}`}
            title={`${i + 1}. ${anchor.label}`}
            aria-label={`Jump to anchor ${i + 1}: ${anchor.label}`}
            aria-current={active ? 'true' : undefined}
            onClick={() => onJump(anchor.index)}
          />
        );
      })}
    </div>
  );
};
