/**
 * Skill audience gate for the Canvas Agent.
 *
 * Pulse Canvas installs its `pulse-canvas` CLI skills into the shared
 * `~/.pulse-coder` / `~/.claude` / `~/.codex` skill dirs for external agents,
 * and the Canvas Agent scans the same dirs. Those CLI skills tell the model to
 * mutate the canvas through `bash`, which skips the native tools and the
 * node-creation approval gate. A SKILL.md opts out of the Canvas Agent with
 * `canvas-agent: false` in its front matter; the engine registry and the
 * settings list both apply this one predicate.
 */
const CANVAS_AGENT_SKILL_KEY = 'canvas-agent';

export function isCanvasAgentSkill(metadata: Record<string, unknown> | undefined): boolean {
  const value = metadata?.[CANVAS_AGENT_SKILL_KEY];
  return value !== false && value !== 'false';
}
