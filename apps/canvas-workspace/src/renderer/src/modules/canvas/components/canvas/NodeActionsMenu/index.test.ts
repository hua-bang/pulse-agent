import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../../../../types';
import type { PaletteCommand } from '../CommandPalette';
import { findNodeAtPoint, selectNodeMenuCommands } from '.';

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
