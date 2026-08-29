import { describe, expect, it } from 'vitest';
import { serializeMcpAppToolArguments } from './mcp-apps';

describe('serializeMcpAppToolArguments', () => {
  it('rejects a hidden tail instead of truncating approval text', () => {
    expect(() => serializeMcpAppToolArguments({
      visible: 'safe',
      hidden: 'x'.repeat(4_000),
    })).toThrow('approval limit');
  });

  it('rejects cyclic arguments', () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(() => serializeMcpAppToolArguments(value)).toThrow('JSON serializable');
  });
});
