import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { installSkills } from '../install-skills';

describe('installSkills', () => {
  it('installs the canvas research skills', async () => {
    const target = join(tmpdir(), `pulse-canvas-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    try {
      const result = await installSkills(target);

      expect(result.ok).toBe(true);
      expect(result.paths.map((p) => p.replace(target, '<target>')).sort()).toEqual([
        '<target>/canvas-bootstrap/SKILL.md',
        '<target>/canvas-deep-research/SKILL.md',
        '<target>/canvas-frame-research/SKILL.md',
        '<target>/pulse-canvas/SKILL.md',
      ]);

      const bootstrap = await fs.readFile(join(target, 'canvas-bootstrap', 'SKILL.md'), 'utf-8');
      const canvas = await fs.readFile(join(target, 'pulse-canvas', 'SKILL.md'), 'utf-8');
      const deepResearch = await fs.readFile(join(target, 'canvas-deep-research', 'SKILL.md'), 'utf-8');
      const frameResearch = await fs.readFile(join(target, 'canvas-frame-research', 'SKILL.md'), 'utf-8');

      expect(canvas).toContain('name: pulse-canvas');
      expect(canvas).toContain('Whenever `$PULSE_CANVAS_WORKSPACE_ID` is set');
      expect(canvas).toContain('pulse-canvas context --format json');
      expect(bootstrap).toContain('Phase 0: Depth Gate');
      expect(bootstrap).toContain('Plan Approval Gate');
      expect(bootstrap).toContain('User-explicit research skill');
      expect(bootstrap).toContain('Node type strategy');
      expect(bootstrap).toContain('Action layer: omit by default');
      expect(bootstrap).toContain('canvas_apply_layout({ mode: "frame_grid"');
      expect(deepResearch).toContain('source_ledger');
      expect(deepResearch).toContain('canvas_candidates');
      expect(frameResearch).toContain('Resolve the Target Frame');
      expect(frameResearch).toContain('Layout Only the Frame');
      expect(frameResearch).toContain('Do not run `canvas_grid`');
    } finally {
      await fs.rm(target, { recursive: true, force: true });
    }
  });
});
