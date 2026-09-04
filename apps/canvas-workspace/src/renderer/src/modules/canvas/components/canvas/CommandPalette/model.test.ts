import { describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../../../types';
import { buildPaletteSections, type PaletteCommand } from './model';

const node = (id: string, title: string, data: CanvasNode['data']): CanvasNode => ({
  id, title, data, type: 'file', x: 0, y: 0, width: 200, height: 120,
});

describe('CommandPalette model', () => {
  it('orders node match quality before command aliases and excludes disabled commands', () => {
    const nodes = [
      node('prefix', 'Roadmap', { filePath: '', content: '' }),
      node('content', 'Notes', { filePath: '/tmp/notes.md', content: 'The roadmap lives here' }),
    ];
    const commands: PaletteCommand[] = [
      { id: 'fit', title: 'Fit all', group: 'view', aliases: ['road view'], run: vi.fn() },
      { id: 'hidden', title: 'Road hidden', group: 'view', enabled: false, run: vi.fn() },
    ];
    const sections = buildPaletteSections(nodes, commands, 'road');
    expect(sections.map((section) => section.id)).toEqual(['nodes', 'commands']);
    expect(sections[0].items.map((item) => item.kind === 'node' ? item.node.id : item.command.id))
      .toEqual(['prefix', 'content']);
    expect(sections[1].items.map((item) => item.kind === 'command' ? item.command.id : item.node.id))
      .toEqual(['fit']);
  });
});
