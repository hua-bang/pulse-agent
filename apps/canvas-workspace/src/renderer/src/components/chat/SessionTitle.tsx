import { Fragment } from 'react';
import { DOM_MENTION_PREFIX } from './constants';
import { MentionNodeIcon } from './utils/mentions';
import { sessionTitleParts, sessionTitleText } from './utils/sessionTitle';

interface Props {
  value: string;
}

/**
 * Renders serialized composer mentions as compact references rather than
 * exposing their storage marker and internal id in a session title.
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
        <Fragment key={`${part.text}-${index}`}>{part.text}</Fragment>
      ))}
    </span>
  );
};
