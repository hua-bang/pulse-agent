import { DOM_MENTION_PREFIX } from './constants';
import { MentionNodeIcon } from './utils/mentions';
import { sessionTitleParts, sessionTitleText } from './utils/sessionTitle';

interface Props {
  value: string;
}

/**
 * Renders serialized composer mentions as compact references rather than
 * exposing their storage marker and internal id in a session title.
 *
 * Reference chips never shrink below their label (`chat-session-title-reference`
 * is `flex-shrink: 0`) — the free-form text between/after them is the part
 * that gives way, via its own `chat-session-title-text` truncation. Plain
 * text used to render as a bare `Fragment` (no element to hang truncation
 * styling on); as an anonymous flex item its shrink minimum defaulted to its
 * min-content width, which for an unbroken run like a URL is its full
 * rendered width. With nothing else free to shrink, the flex algorithm
 * pushed all of the negative space onto the chips instead, collapsing
 * multi-mention titles into unlabeled icon slivers.
 */
export const SessionTitle = ({ value }: Props) => {
  const parts = sessionTitleParts(value);

  if (parts.length === 0) return <>{value}</>;

  return (
    <span className="chat-session-title" aria-label={sessionTitleText(value)}>
      {parts.map((part, index) => part.marker ? (
        <span
          className="chat-session-title-reference"
          key={`${part.marker}-${index}`}
          title={part.text}
        >
          <MentionNodeIcon size={12} nodeType={part.marker.startsWith(DOM_MENTION_PREFIX) ? 'dom' : 'file'} />
          <span>{part.text}</span>
        </span>
      ) : (
        <span className="chat-session-title-text" key={`${part.text}-${index}`}>{part.text}</span>
      ))}
    </span>
  );
};
