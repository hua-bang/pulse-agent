import { describe, expect, it } from 'vitest';
import { optionsFromPluginStatus } from './model';

describe('optionsFromPluginStatus', () => {
  it('projects healthy manifest nodes and gives boards their larger default size', () => {
    const options = optionsFromPluginStatus({
      path: '/tmp/plugins.json',
      pluginDirs: ['/tmp/demo'],
      rendererSpecs: [],
      plugins: [
        {
          id: 'demo',
          dir: '/tmp/demo',
          manifestPath: '/tmp/demo/manifest.json',
          version: '1.2.3',
          nodes: [
            { type: 'demo.widget', title: ' Widget ' },
            { type: 'excalidraw.board' },
          ],
          rendererSpecs: [],
        },
        {
          id: 'broken',
          dir: '/tmp/broken',
          manifestPath: '/tmp/broken/manifest.json',
          error: 'invalid manifest',
          nodes: [{ type: 'broken.widget' }],
          rendererSpecs: [],
        },
      ],
    });

    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({
      key: 'demo:demo.widget',
      title: 'Widget',
      nodePatch: { width: 640, height: 420 },
    });
    expect(options[1]).toMatchObject({
      key: 'demo:excalidraw.board',
      title: 'excalidraw.board',
      nodePatch: { width: 900, height: 640 },
    });
  });
});
