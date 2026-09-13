import { describe, expect, it, vi } from 'vitest';
import type { ReadlineHost } from './host-context.js';
import type { ReadlineCommands } from './host-commands.js';
import { routeSlashInput } from './command-surface.js';

function buildHost(): ReadlineHost {
  return {
    skillCommands: {
      findSkill: vi.fn((name: string) => name === 'fix-pulse-agent-issue'
        ? { name: 'fix-pulse-agent-issue', description: 'Fix one Pulse Agent issue' }
        : null),
    },
    tui: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as ReadlineHost;
}

describe('routeSlashInput', () => {
  it('routes a direct installed-skill slash command to the agent message', async () => {
    const host = buildHost();
    const commands = {
      handleCommand: vi.fn(),
    } as unknown as ReadlineCommands;

    const result = await routeSlashInput(
      host,
      commands,
      '/fix-pulse-agent-issue https://github.com/hua-bang/pulse-agent/issues/1022',
    );

    expect(result).toEqual({
      kind: 'message',
      message: '[use skill](fix-pulse-agent-issue) https://github.com/hua-bang/pulse-agent/issues/1022',
    });
    expect(commands.handleCommand).not.toHaveBeenCalled();
  });
});
