import type { MouseEventHandler, RefObject } from 'react';
import './index.css';

interface Props {
  bodyRef: RefObject<HTMLDivElement>;
  html: string;
  streaming?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

export const MarkdownContent = ({ bodyRef, html, streaming = false, onClick }: Props) => (
  <div
    ref={bodyRef}
    className={`chat-message-content chat-md${streaming ? ' chat-md--streaming' : ''}`}
    dangerouslySetInnerHTML={{ __html: html }}
    onClick={onClick}
  />
);
