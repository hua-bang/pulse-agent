import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { readConfig, resolveEffectiveFields, sanitizeConfig } from '../model/config';

/**
 * Model-parity bridge for the pi-native backend: mirror the canvas model
 * configuration (provider type, base URL, key, model id) into a pi custom
 * provider, so a pi-backed chat calls the SAME upstream as the engine —
 * including third-party OpenAI/Anthropic-compatible endpoints. Without this
 * pi resolves models from the user's own `~/.pi/agent` and comparisons
 * silently run on different providers (the invalid_api_key 401 class of
 * failure).
 *
 * Mechanism: write `models.json` into a canvas-owned pi config dir and point
 * the spawned pi at it via `PI_CODING_AGENT_DIR` (documented override for
 * `~/.pi/agent`). This keeps the user's personal pi setup untouched and
 * makes canvas-run pi hermetic — its sessions/extensions live under our dir.
 * The key is written 0600 into the user's own home, matching the runtime
 * file's trust model. Credentials come from the same
 * `resolveEffectiveFields` chain `resolveCanvasModel` uses, so parity holds
 * by construction; the per-scope configured model may override the id.
 */

export const PI_BRIDGE_PROVIDER_ID = 'canvas';

const DEFAULT_BASE_URLS: Record<string, string> = {
  claude: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
};

export interface PiModelBridge {
  env: Record<string, string>;
  extraArgs: string[];
}

export const piBridgeDir = (): string =>
  process.env.PULSE_CANVAS_PI_BRIDGE_DIR?.trim()
  || join(homedir(), '.pulse-coder', 'canvas', 'pi-agent');

/**
 * Returns undefined when the canvas config carries no usable key — then the
 * run falls back to the user's own pi configuration instead of shipping a
 * provider that can only 401.
 */
export async function preparePiModelBridge(
  modelOverride?: string,
): Promise<PiModelBridge | undefined> {
  const resolved = resolveEffectiveFields(sanitizeConfig(await readConfig()));
  const apiKey = resolved.apiKey;
  const model = modelOverride?.trim() || resolved.model?.trim();
  if (!apiKey || !model) return undefined;

  const isClaude = resolved.providerType === 'claude';
  const baseUrl = resolved.baseURL?.trim()
    || DEFAULT_BASE_URLS[isClaude ? 'claude' : 'openai'];

  const dir = piBridgeDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    join(dir, 'models.json'),
    JSON.stringify({
      providers: {
        [PI_BRIDGE_PROVIDER_ID]: {
          name: resolved.provider?.name ?? 'Pulse Canvas model',
          baseUrl,
          api: isClaude ? 'anthropic-messages' : 'openai-completions',
          apiKey,
          models: [{ id: model }],
        },
      },
    }, null, 2),
    { mode: 0o600 },
  );

  return {
    env: { PI_CODING_AGENT_DIR: dir },
    extraArgs: ['--provider', PI_BRIDGE_PROVIDER_ID, '--model', model],
  };
}
