import { isAbsolute } from 'path';
import { z } from 'zod';

import { CapabilityError, type AnyCapabilityDefinition } from './types';

/** Tells an agent outside Pulse Canvas how the in-app guide maps to the CLI. */
const EXTERNAL_GUIDE_NOTE = `> You are outside Pulse Canvas. Where this guide says to call \`canvas_plugin_install\`
> with a folder, run \`pulse-canvas plugin install <dir>\` instead. It returns the same JSON report.
> The chat install card does not exist for you: when \`nativeEnabled\` is false, the user enables the
> plugin on the Plugins page in Pulse Canvas. Follow \`nextStep\` in the report.

`;

export interface PluginCapabilityDependencies {
  install: (dir: string) => Promise<unknown>;
  guide: () => Promise<string>;
}

const defaultDependencies: PluginCapabilityDependencies = {
  install: async (dir) => (
    await import('../../agent/tools/plugins/install')
  ).installPluginDirectory(dir, 'external'),
  guide: async () => (await import('../../agent/skills/canvas-plugin-skill')).CREATE_CANVAS_PLUGIN_SKILL.body,
};

/**
 * Plugin authoring for coding agents outside the app (Claude Code, Codex).
 * Install uses the same market path as the Canvas Agent tool, so native code
 * stays off until the user enables it in the app.
 */
export function createPluginCapabilities(
  dependencies: PluginCapabilityDependencies = defaultDependencies,
): AnyCapabilityDefinition[] {
  return [
    {
      name: 'plugins.guide',
      description: 'Return the guide for writing a Pulse Canvas plugin: folder layout, plugin.json, renderer and main APIs.',
      risk: 'read',
      inputSchema: z.object({}),
      execute: async () => ({ guide: EXTERNAL_GUIDE_NOTE + await dependencies.guide() }),
    },
    {
      name: 'plugins.install',
      description:
        'Install or re-register a local plugin folder (holds plugin.json) and return diagnostics. '
        + 'An enabled plugin reloads at once; native code of a new plugin stays off until the user enables it.',
      risk: 'operate',
      inputSchema: z.object({
        dir: z.string().min(1).describe('Absolute path of the plugin folder.'),
      }),
      execute: async ({ dir }) => {
        if (!isAbsolute(dir.trim())) {
          throw new CapabilityError('invalid_input', 'dir must be an absolute path');
        }
        return dependencies.install(dir.trim());
      },
    },
  ];
}
