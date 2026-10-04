import { useMemo, useRef, type MouseEventHandler } from 'react';
import { useI18n } from '../../../../../i18n';
import { copyTextToClipboard } from '../../../../../utils/clipboard';
import { renderMarkdown, type MarkdownVariant } from '../../utils/markdown';
import { MarkdownContent } from '.';

interface Props {
  content: string;
  softBreaks?: boolean;
  /** `note` drops chat typography so a note host's document styles apply. */
  variant?: MarkdownVariant;
}

const NOTE_PREVIEW_CLASS = 'note-markdown-preview';

/** Read-only Markdown preview, including the renderer's code-copy interaction. */
export const MarkdownPreview = ({ content, softBreaks, variant = 'chat' }: Props) => {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(content, { softBreaks, variant }), [content, softBreaks, variant]);
  const copyCode: MouseEventHandler<HTMLDivElement> = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action="copy-code"]');
    if (!button) return;
    const code = button.closest('[data-code-block]')?.querySelector('code')?.textContent ?? '';
    void copyTextToClipboard(code.replace(/\n$/, '')).then(() => {
      button.textContent = t('chat.copied');
    }).catch(() => {
      button.textContent = t('chat.copy');
    });
  };

  return (
    <MarkdownContent
      bodyRef={bodyRef}
      html={html}
      onClick={copyCode}
      className={variant === 'note' ? NOTE_PREVIEW_CLASS : undefined}
    />
  );
};
