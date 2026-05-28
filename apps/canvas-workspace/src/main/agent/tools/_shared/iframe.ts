import type { NodeType } from '../types';
import { BLANK_PAGE_URL } from './canvas-io';

export function normalizeIframeUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lowered = trimmed.toLowerCase();
  if (lowered === 'blank' || lowered === BLANK_PAGE_URL) return BLANK_PAGE_URL;
  return trimmed;
}

export function isLikelyFullHtml(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  return (
    /^<!doctype\s+html\b/i.test(text) ||
    /<html[\s>]/i.test(text) ||
    (/<body[\s>]/i.test(text) && /<\/body>/i.test(text)) ||
    (/<style[\s>]/i.test(text) && /<\/(div|main|section|article|body)>/i.test(text))
  );
}

export function shouldCreateIframeForHtml(
  requestedType: NodeType,
  content: string,
  extraData: Record<string, unknown>,
): boolean {
  if (requestedType !== 'file') return false;
  const explicitRenderAs = String(extraData.renderAs ?? extraData.kind ?? '').toLowerCase();
  if (explicitRenderAs === 'note' || explicitRenderAs === 'markdown' || explicitRenderAs === 'file') {
    return false;
  }
  const contentType = String(extraData.contentType ?? extraData.mimeType ?? '').toLowerCase();
  return (
    explicitRenderAs === 'html' ||
    contentType.includes('text/html') ||
    contentType === 'html' ||
    isLikelyFullHtml(content)
  );
}
