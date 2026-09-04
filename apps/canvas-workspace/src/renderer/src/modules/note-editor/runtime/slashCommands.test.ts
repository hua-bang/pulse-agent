import { describe, expect, it } from 'vitest';
import {
  ALL_SLASH_COMMANDS,
  SLASH_COMMAND_GROUP_ORDER,
  filterCmds,
  groupSlashCommands,
  parseSlashQuery,
} from './slashCommands';

describe('slash command registry', () => {
  it('keeps every command in a declared group and stable group order', () => {
    const grouped = groupSlashCommands(ALL_SLASH_COMMANDS);

    expect(grouped.map((group) => group.id)).toEqual(SLASH_COMMAND_GROUP_ORDER);
    expect(grouped.flatMap((group) => group.items)).toEqual(ALL_SLASH_COMMANDS);
  });

  it('matches English aliases and multi-word queries', () => {
    expect(filterCmds('todo').map((command) => command.id)).toEqual(['task']);
    expect(filterCmds('code block').map((command) => command.id)).toEqual(['code']);
  });

  it('matches Chinese aliases without depending on the active locale', () => {
    expect(filterCmds('标题').map((command) => command.id)).toEqual(['h1', 'h2', 'h3']);
    expect(filterCmds('表格').map((command) => command.id)).toEqual(['table']);
  });

  it('normalizes whitespace and matches every query token', () => {
    expect(filterCmds('  numbered   list ').map((command) => command.id)).toEqual(['ol']);
    expect(filterCmds('insert image').map((command) => command.id)).toEqual(['image']);
  });
});

describe('parseSlashQuery', () => {
  it('detects a slash query containing CJK text', () => {
    const textBeforeCursor = '上一行\n/标题';
    const cursorPos = 42;

    expect(parseSlashQuery(textBeforeCursor, cursorPos)).toEqual({
      query: '标题',
      slashFrom: cursorPos - 3,
    });
  });

  it('keeps spaces in a multi-word query', () => {
    const textBeforeCursor = ' /code block';
    const cursorPos = 100;

    expect(parseSlashQuery(textBeforeCursor, cursorPos)).toEqual({
      query: 'code block',
      slashFrom: cursorPos - '/code block'.length,
    });
  });

  it('does not treat a slash inside a URL or word as a command', () => {
    expect(parseSlashQuery('https://pulse.local', 20)).toBeNull();
    expect(parseSlashQuery('prefix/heading', 14)).toBeNull();
  });

  it('uses the latest slash after a block boundary', () => {
    const textBeforeCursor = 'ignored /old\n/new';
    const cursorPos = 18;

    expect(parseSlashQuery(textBeforeCursor, cursorPos)).toEqual({
      query: 'new',
      slashFrom: cursorPos - 4,
    });
  });
});
