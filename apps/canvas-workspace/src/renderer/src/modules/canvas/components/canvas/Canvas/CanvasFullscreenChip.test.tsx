// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CanvasFullscreenChip } from './CanvasFullscreenChip';
import { I18nProvider } from '../../../../../i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderChip = (props: Parameters<typeof CanvasFullscreenChip>[0]) => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<I18nProvider><CanvasFullscreenChip {...props} /></I18nProvider>));
  const chatButton = () => host.querySelector<HTMLButtonElement>('button[aria-label*="AI Chat"]');
  return { chatButton, dispose: () => { act(() => root.unmount()); host.remove(); } };
};

it('adds the fullscreen node to chat instead of only opening chat', () => {
  const onChatOpen = vi.fn(), onAddNodeToChat = vi.fn();
  const chip = renderChip({ onChatOpen, onAddNodeToChat, onExitFullscreen: vi.fn() });
  try {
    act(() => chip.chatButton()?.click());
    expect(onAddNodeToChat).toHaveBeenCalledTimes(1);
    expect(onChatOpen).not.toHaveBeenCalled();
  } finally { chip.dispose(); }
});

it('falls back to opening chat when node context is unavailable', () => {
  const onChatOpen = vi.fn();
  const chip = renderChip({ onChatOpen, onExitFullscreen: vi.fn() });
  try {
    act(() => chip.chatButton()?.click());
    expect(onChatOpen).toHaveBeenCalledTimes(1);
  } finally { chip.dispose(); }
});
