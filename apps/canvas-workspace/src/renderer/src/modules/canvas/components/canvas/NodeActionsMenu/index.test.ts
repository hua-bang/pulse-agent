import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../../../../types';
import type { PaletteCommand } from '../CommandPalette';
import { findNodeAtPoint, selectNodeMenuCommands, startsMenuSection } from '.';

const node = (id: string, x: number, y: number, width: number, height: number) =>
  ({ id, type: 'file', x, y, width, height, title: id, data: {} }) as unknown as CanvasNode;

const command = (id: string, enabled?: boolean): PaletteCommand => ({
  id, title: id, group: 'edit', enabled, run: () => {},
});

describe('findNodeAtPoint', () => {
  it('picks the smallest node under the point, so a child wins over its frame', () => {
    const frame = node('frame', 0, 0, 600, 400);
    const child = node('child', 100, 100, 200, 150);
    expect(findNodeAtPoint([child, frame], { x: 150, y: 150 })?.id).toBe('child');
    expect(findNodeAtPoint([child, frame], { x: 500, y: 350 })?.id).toBe('frame');
    expect(findNodeAtPoint([child, frame], { x: 900, y: 900 })).toBeUndefined();
  });
});

describe('selectNodeMenuCommands', () => {
  it('keeps the enabled selection commands in menu order with delete last', () => {
    const commands = [
      command('delete-selection'),
      command('create-note'),
      command('ungroup-selection', false),
      command('duplicate-selection'),
    ];
    expect(selectNodeMenuCommands(commands).map((item) => item.id)).toEqual([
      'duplicate-selection',
      'delete-selection',
    ]);
  });

  it('offers align for two nodes and distribute only for three, as its own section', () => {
    const forCount = (count: number) => [
      command('duplicate-selection'),
      command('align-left', count >= 2),
      command('align-top', count >= 2),
      command('align-distributeX', count >= 3),
      command('delete-selection'),
    ];
    expect(selectNodeMenuCommands(forCount(1)).map((item) => item.id)).toEqual([
      'duplicate-selection',
      'delete-selection',
    ]);
    const two = selectNodeMenuCommands(forCount(2));
    expect(two.map((item) => item.id)).toEqual([
      'duplicate-selection',
      'align-left',
      'align-top',
      'delete-selection',
    ]);
    expect(two.map((_, index) => startsMenuSection(two, index))).toEqual([false, true, false, true]);
    expect(selectNodeMenuCommands(forCount(3)).map((item) => item.id)).toContain('align-distributeX');
  });

  it('leads with rename and add-to-chat when the palette offers them', () => {
    const commands = [
      command('delete-selection'),
      command('add-selection-to-chat'),
      command('rename-selection'),
    ];
    expect(selectNodeMenuCommands(commands).map((item) => item.id)).toEqual([
      'rename-selection',
      'add-selection-to-chat',
      'delete-selection',
    ]);
  });
});
