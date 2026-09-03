import { describe, expect, it } from 'vitest';
import {
  BUNDLE_FEATURE_ENTRIES,
  findBundleFeatureEntryKeys,
} from './bundle-features.mjs';

describe('bundle feature entries', () => {
  it('finds the directory-based ChatPanel lazy entry in the Vite manifest', () => {
    const chat = BUNDLE_FEATURE_ENTRIES.find(feature => feature.id === 'chat');
    const manifest = {
      'src/modules/chat/components/ChatPanel/index.tsx': {
        file: 'assets/chat-panel.js',
        isDynamicEntry: true,
      },
      'src/modules/chat/components/ChatPage/index.tsx': {
        file: 'assets/chat-page.js',
        isDynamicEntry: true,
      },
    };

    expect(chat).toBeDefined();
    expect(findBundleFeatureEntryKeys(manifest, chat)).toEqual([
      'src/modules/chat/components/ChatPanel/index.tsx',
    ]);
  });
});
