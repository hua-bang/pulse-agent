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
      'mcp-apps-basic-react',
      'mcp-apps-map',
      'mcp-apps-threejs',
    ]);
  });

  it('only exposes strict Agent Plugins packages as installable listings', () => {
    expect(PUBLIC_PLUGIN_CATALOG).toHaveLength(9);
    expect(PUBLIC_PLUGIN_CATALOG.every((listing) => (
      listing.sourceFormat === 'agent-plugin'
      && listing.installState === 'available'
      && listing.source.kind === 'git'
      && listing.source.url?.startsWith('https://github.com/')
      && /^[a-f0-9]{40}$/.test(listing.source.ref ?? '')
    ))).toBe(true);
  });

  it('keeps repository subdirectories explicit for monorepo packages', () => {
    expect(PUBLIC_PLUGIN_CATALOG.find((listing) => listing.id === 'opnform')?.source)
      .toEqual({
        kind: 'git',
        url: 'https://github.com/OpnForm/OpnForm.git',
        ref: 'e4bb538a2ed9f8480260abca3659150b74e9ce87',
        subdir: 'plugins/opnform',
      });
  });

  it('pins MCP Apps demos to the commit containing their Agent Plugin wrappers', () => {
    const demos = PUBLIC_PLUGIN_CATALOG.filter((listing) => listing.id.startsWith('mcp-apps-'));
    expect(demos).toHaveLength(3);
    expect(demos.every((listing) => (
      listing.source.kind === 'git'
      && listing.source.url === 'https://github.com/hua-bang/pulse-agent.git'
      && listing.source.ref === 'dab497a6ae5e64b32f4ed5291d243e173d1f8b26'
      && listing.source.subdir === `examples/agent-plugins/${listing.id}`
    ))).toBe(true);
  });
});
