import { describe, expect, it, vi } from 'vitest';
import { createMcpAppIconResolver, withMcpAppIcons } from './mcp-app-icons';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2h16v16H2z" stroke="currentColor"/></svg>';
const svgBase64 = Buffer.from(SVG).toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const response = (body: Buffer | string, contentType: string, init: ResponseInit = {}) => (
  new Response(typeof body === 'string' ? body : new Uint8Array(body), {
    status: 200,
    headers: { 'content-type': contentType },
    ...init,
  })
);

describe('createMcpAppIconResolver', () => {
  it('normalizes data URI icons to base64 and renders SVG as a mask', async () => {
    const resolver = createMcpAppIconResolver(vi.fn());
    await expect(resolver.resolve([{ src: `data:image/svg+xml,${encodeURIComponent(SVG)}` }]))
      .resolves.toEqual({ default: { kind: 'mask', src: `data:image/svg+xml;base64,${svgBase64}` } });
  });

  it('fetches https icons in the main process and keeps light and dark variants', async () => {
    const fetcher = vi.fn(async (url: string) => (
      url.endsWith('dark.png') ? response(PNG, 'image/png') : response(SVG, 'image/svg+xml; charset=utf-8')
    ));
    const resolver = createMcpAppIconResolver(fetcher);
    const icons = await resolver.resolve([
      { src: 'https://cdn.example/light.svg', theme: 'light' },
      { src: 'https://cdn.example/dark.png', theme: 'dark' },
    ]);
    expect(icons).toEqual({
      default: { kind: 'mask', src: `data:image/svg+xml;base64,${svgBase64}` },
      dark: { kind: 'image', src: `data:image/png;base64,${PNG.toString('base64')}` },
    });

    await resolver.resolve([{ src: 'https://cdn.example/light.svg' }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects unsafe schemes, unsupported or mislabeled content, and oversized icons', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('fake.png')) return response('<html>nope</html>', 'image/png');
      if (url.endsWith('page.html')) return response('<svg></svg>', 'text/html');
      if (url.endsWith('huge.svg')) return response(`<svg>${'x'.repeat(200 * 1024)}</svg>`, 'image/svg+xml');
      return response('', 'image/png', { status: 404 });
    });
    const resolver = createMcpAppIconResolver(fetcher);
    await expect(resolver.resolve([
      { src: 'http://cdn.example/icon.svg' },
      { src: 'javascript:alert(1)' },
      { src: 'https://cdn.example/fake.png' },
      { src: 'https://cdn.example/page.html' },
      { src: 'https://cdn.example/huge.svg' },
      { src: 'https://cdn.example/missing.png' },
      { src: 'data:text/html;base64,PHN2Zz48L3N2Zz4=' },
    ])).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});

describe('withMcpAppIcons', () => {
  it('attaches icons only to listings whose tool declares one', async () => {
    const listing = (toolName: string) => ({
      serverName: 'mock', toolName, resourceUri: `ui://mock/${toolName}`, title: toolName, kind: 'global' as const,
    });
    const result = await withMcpAppIcons(
      [listing('parts'), listing('board')],
      [
        { serverName: 'mock', toolName: 'parts', registeredToolName: 'mcp_mock_parts', resourceUri: 'ui://mock/parts',
          icons: [{ src: `data:image/svg+xml;base64,${svgBase64}` }] },
        { serverName: 'mock', toolName: 'board', registeredToolName: 'mcp_mock_board', resourceUri: 'ui://mock/board' },
      ],
      createMcpAppIconResolver(vi.fn()),
    );
    expect(result[0].icon).toEqual({ default: { kind: 'mask', src: `data:image/svg+xml;base64,${svgBase64}` } });
    expect(result[1]).not.toHaveProperty('icon');
  });
});
