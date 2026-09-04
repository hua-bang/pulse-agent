export const BLANK_PAGE_URL = 'about:blank';

export const normalizeUrl = (input: string): string => {
  if (!input) return '';
  const lowered = input.toLowerCase();
  if (lowered === 'blank' || lowered === BLANK_PAGE_URL) return BLANK_PAGE_URL;
  if (/^[a-z]+:\/\//i.test(input)) return input;
  if (/^\/\//.test(input)) return `https:${input}`;
  return `https://${input}`;
};
