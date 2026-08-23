import { describe, expect, it } from 'vitest';
import { PUBLIC_PLUGIN_CATALOG } from './catalog';

describe('PUBLIC_PLUGIN_CATALOG', () => {
  it('ships the reviewed launch catalog in its intended order', () => {
    expect(PUBLIC_PLUGIN_CATALOG.map((listing) => listing.id)).toEqual([
      'exa',
      'transcriptapi',
      'arcade',
      'resend',
      'opnform',
      'mobbin',
    ]);
  });

  it('only exposes strict Agent Plugins packages as installable listings', () => {
    expect(PUBLIC_PLUGIN_CATALOG).toHaveLength(6);
    expect(PUBLIC_PLUGIN_CATALOG.every((listing) => (
      listing.sourceFormat === 'agent-plugin'
      && listing.installState === 'available'
      && listing.source.kind === 'git'
      && listing.source.url?.startsWith('https://github.com/')
    ))).toBe(true);
  });

  it('keeps repository subdirectories explicit for monorepo packages', () => {
    expect(PUBLIC_PLUGIN_CATALOG.find((listing) => listing.id === 'opnform')?.source)
      .toEqual({
        kind: 'git',
        url: 'https://github.com/OpnForm/OpnForm.git',
        subdir: 'plugins/opnform',
      });
  });
});
