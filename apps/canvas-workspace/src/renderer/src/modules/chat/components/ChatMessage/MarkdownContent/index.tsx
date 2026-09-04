import type { RefObject } from 'react';
import './index.css';

interface Props {
  bodyRef: RefObject<HTMLDivElement>;
  html: string;
  streaming?: boolean;
}

export const MarkdownContent = ({ bodyRef, html, streaming = false }: Props) => (
  <div
    ref={bodyRef}
    className={`chat-message-content chat-md${streaming ? ' chat-md--streaming' : ''}`}
    dangerouslySetInnerHTML={{ __html: html }}
  />
);
