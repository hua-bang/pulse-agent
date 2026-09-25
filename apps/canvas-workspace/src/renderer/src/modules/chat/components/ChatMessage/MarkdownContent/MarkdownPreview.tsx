import { useMemo, useRef, type MouseEventHandler } from 'react';
import { useI18n } from '../../../../../i18n';
import { copyTextToClipboard } from '../../../../../utils/clipboard';
import { renderMarkdown } from '../../utils/markdown';
import { MarkdownContent } from '.';

interface Props {
  content: string;
  softBreaks?: boolean;
}

/** Read-only Markdown preview, including the renderer's code-copy interaction. */
export const MarkdownPreview = ({ content, softBreaks }: Props) => {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(content, { softBreaks }), [content, softBreaks]);
  const copyCode: MouseEventHandler<HTMLDivElement> = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action="copy-code"]');
    if (!button) return;
    const code = button.closest('.chat-code-block')?.querySelector('code')?.textContent ?? '';
    void copyTextToClipboard(code.replace(/\n$/, '')).then(() => {
      button.textContent = t('chat.copied');
    }).catch(() => {
      button.textContent = t('chat.copy');
    });
  };

  return <MarkdownContent bodyRef={bodyRef} html={html} onClick={copyCode} />;
};
