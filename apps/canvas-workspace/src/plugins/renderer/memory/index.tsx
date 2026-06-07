/**
 * Memory plugin — renderer half. Adds a "记忆" nav item + /memory route that
 * renders the memory panel (browse / search / pin / forget memory by scope).
 * Talks to the main half via ctx.invoke → plugin:memory:* IPC.
 */

import { useLocation } from 'wouter';
import { KnowledgeStoreIcon } from '../../../renderer/src/components/icons';
import type { RendererCanvasPlugin, RendererCtx } from '../../types';
import { MemoryPage } from './MemoryPage';

const MemoryRoute = ({ invoke }: { invoke: RendererCtx['invoke'] }) => {
  const [, setLocation] = useLocation();
  return <MemoryPage invoke={invoke} onBackToCanvas={() => setLocation('/')} />;
};

export const MemoryRendererPlugin: RendererCanvasPlugin = {
  id: 'memory',
  activate(ctx) {
    ctx.registerRoute('/memory', () => <MemoryRoute invoke={ctx.invoke} />);
    ctx.registerNavItem({
      id: 'memory',
      path: '/memory',
      label: '记忆',
      title: 'Agent 记忆',
      icon: KnowledgeStoreIcon,
    });
  },
};
