import { describe, expect, it } from 'vitest';
import { serializeMcpAppToolArguments } from './mcp-apps';

describe('serializeMcpAppToolArguments', () => {
  it('truncates only the approval preview while retaining the complete payload', () => {
    const result = serializeMcpAppToolArguments({
      visible: 'safe',
      hidden: 'x'.repeat(4_000),
    });
    expect(result.truncated).toBe(true);
    expect(result.preview.length).toBeLessThan(result.serialized.length + 100);
    expect(JSON.parse(result.serialized)).toMatchObject({ visible: 'safe' });
  });

  it('accepts Cowart-sized snapshots but retains a 16 MiB execution bound', () => {
    expect(serializeMcpAppToolArguments({ snapshot: 'x'.repeat(64_000) }).size).toBeGreaterThan(64_000);
    expect(() => serializeMcpAppToolArguments({ snapshot: 'x'.repeat(16 * 1024 * 1024) }))
      .toThrow('16 MiB host limit');
  });

  it('rejects cyclic arguments', () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(() => serializeMcpAppToolArguments(value)).toThrow('JSON serializable');
  });
});
