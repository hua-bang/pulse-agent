import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatPageCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const rightDockCss = readFileSync(new URL('../../../dock/RightDock/index.css', import.meta.url), 'utf8');
const rendererCss = readFileSync(new URL('../../../../styles.css', import.meta.url), 'utf8');

describe('ChatPage narrow-window layout', () => {
  it('uses the chat container, not the full window, before the rail can squeeze the conversation', () => {
    expect(chatPageCss).toMatch(
      /\.chat-page\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*chat-page;/s,
    );
    const breakpoint = chatPageCss.indexOf('@container chat-page (max-width: 760px)');
    const nextBreakpoint = chatPageCss.indexOf('@container chat-page (max-width: 520px)', breakpoint);
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
      /\.chat-page-rail-wrapper\s*\{[^}]*inset:\s*var\(--app-topbar-height\) auto 0 0;/s,
    );
    expect(rendererCss).toMatch(/:root\s*\{[^}]*--app-topbar-height:\s*49px;/s);
    expect(chatPageCss).toMatch(
      /\.chat-page-topbar\s*\{[^}]*min-height:\s*var\(--app-topbar-height\);/s,
    );
    expect(rightDockCss).toMatch(
      /\.right-dock__tabs\[data-visible="true"\]\s*\{[^}]*height:\s*var\(--app-topbar-height\);[^}]*max-height:\s*var\(--app-topbar-height\);/s,
    );
  });
});
