import { describe, expect, it } from 'vitest';

import { createCanvasEnginePlugins } from '../engine-plugins';

// CanvasAgent builds its Engine with `disableBuiltInPlugins: true`, so this list
// is the ONLY way a built-in engine plugin reaches the Canvas Agent — a plugin
// missing here is silently absent, with no type or runtime error. That failure
// shape already bit this repo once: 35 canvas tools carried `defer_loading`
// while the plugin that enforces it (tool-search) was not in the list, so the
// flag was dead config and every tool still reached the model.
const pluginName = (plugin: unknown): string =>
  (plugin as { name?: string })?.name ?? '';

describe('canvas engine plugin list', () => {
  for (const scope of [
    { kind: 'workspace' as const, workspaceId: 'ws-1' },
    { kind: 'global' as const },
  ]) {
    it(`registers tool-search so defer_loading is enforced (${scope.kind})`, () => {
      const names = createCanvasEnginePlugins(scope).map(pluginName);

      expect(names).toContain('pulse-coder-engine/built-in-tool-search');
    });

    it(`keeps the scoped skills / MCP / offload plugins (${scope.kind})`, () => {
      const names = createCanvasEnginePlugins(scope).map(pluginName);

      // Every plugin must be identifiable; an unnamed entry would slip past the
      // assertions below without failing them.
      expect(names.every((name) => name.length > 0)).toBe(true);
      expect(names).toContain('pulse-coder-engine/built-in-skills');
      expect(names).toContain('pulse-coder-engine/built-in-mcp');
      expect(names).toContain('pulse-coder-engine/built-in-tool-offload');
      expect(names).toContain('canvas-agent-observability');
    });
  }
});
