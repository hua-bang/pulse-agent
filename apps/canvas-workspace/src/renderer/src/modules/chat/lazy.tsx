import { Suspense, type ComponentProps } from 'react';
import { preloadableLazy } from '../../shared/preloadableLazy';

// Chat surfaces pull markdown-it + highlight.js + the whole chat component
// tree. React.lazy keeps that out of the eagerly-parsed entry chunk (C3);
// each surface loads on first use (the right-dock panel on first open, the
// page on first /chat visit, or earlier from the shell's idle preload), off
// the startup critical path. Call sites
// import these drop-in wrappers instead of the
// chat index so no static chain re-links the chunk into the entry.
const ChatPageInner = preloadableLazy(() => import('./components/ChatPage').then((m) => ({ default: m.ChatPage })));
const ChatPanelInner = preloadableLazy(() => import('./components/ChatPanel').then((m) => ({ default: m.ChatPanel })));

export const preloadChatSurfaces = () => Promise.all([ChatPageInner.preload(), ChatPanelInner.preload()]);

export const ChatPageLazy = (props: ComponentProps<typeof ChatPageInner>) => (
  <Suspense fallback={null}>
    <ChatPageInner {...props} />
  </Suspense>
);

export const ChatPanelLazy = (props: ComponentProps<typeof ChatPanelInner>) => (
  <Suspense fallback={null}>
    <ChatPanelInner {...props} />
  </Suspense>
);
