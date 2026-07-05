import './index.css';

interface Props {
  /** Short visible label, e.g. "Reference node". */
  label: string;
  /** Full tooltip / accessible name, including the shortcut. */
  title: string;
  onClick: () => void;
}

/**
 * Persistent, compact affordance pinned to a terminal corner that opens the
 * {@link NodeMentionPicker}. Terminals can't show an inline `@` trigger (xterm
 * forwards keys to the PTY), so this keeps the feature discoverable without
 * relying on the Ctrl/⌘+2 shortcut being known.
 */
export const MentionTriggerButton = ({ label, title, onClick }: Props) => (
  <button
    type="button"
    className="node-mention-trigger"
    title={title}
    aria-label={title}
    // Keep the terminal's focus/selection when launching the picker.
    onMouseDown={(event) => event.preventDefault()}
    onClick={(event) => {
      event.stopPropagation();
      onClick();
    }}
  >
    <span className="node-mention-trigger__glyph" aria-hidden="true">@</span>
    <span className="node-mention-trigger__label">{label}</span>
  </button>
);
