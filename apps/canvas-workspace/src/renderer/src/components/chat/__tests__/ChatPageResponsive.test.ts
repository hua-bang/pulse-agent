import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatPageCss = readFileSync(new URL('../ChatPage.css', import.meta.url), 'utf8');

describe('ChatPage narrow-window layout', () => {
  it('overlays the optional session rail before it can squeeze the conversation column', () => {
    const breakpoint = chatPageCss.indexOf('@media (max-width: 1040px)');
    const nextBreakpoint = chatPageCss.indexOf('@media (max-width: 720px)', breakpoint);
    const narrowRules = chatPageCss.slice(
      breakpoint,
      nextBreakpoint === -1 ? undefined : nextBreakpoint,
    );

    expect(breakpoint).toBeGreaterThanOrEqual(0);
    expect(narrowRules).toMatch(
      /\.chat-page-rail-wrapper\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*\d+;/s,
    );
    expect(narrowRules).toMatch(
      /\.chat-page-main\s*\{[^}]*width:\s*100%;/s,
    );
    expect(narrowRules).toMatch(
      /\.chat-page-rail-wrapper\s*\{[^}]*inset:\s*var\(--chat-page-topbar-height\) auto 0 0;/s,
    );
    expect(chatPageCss).toMatch(
      /\.chat-page\s*\{[^}]*--chat-page-topbar-height:\s*49px;/s,
    );
    expect(chatPageCss).toMatch(
      /\.chat-page-topbar\s*\{[^}]*min-height:\s*var\(--chat-page-topbar-height\);/s,
    );
  });
});
