import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { MainCanvasPlugin, MainCtx } from '../../types';
import {
  EXPERIMENTAL_FLAG_CHANNELS,
  resolveFeatureValues,
} from '../../../shared/experimental-features';
import { ChannelBridge } from './core/bridge';
import type { Channel } from './core/types';
import { FeishuChannel } from './channels/feishu/feishu-channel';
import { activateWorkspaceWindow } from '../../../main/app/window-manager';

// Registry of all channel implementations. To add a new channel (Discord,
// Telegram, WeCom, …) implement the `Channel` interface and add it here —
// the orchestration in `core/` is channel-agnostic and needs no changes.
function allChannels(): Channel[] {
  return [new FeishuChannel()];
}

/** True when at least one channel has the configuration it needs to run. */
function anyChannelConfigured(): boolean {
  return allChannels().some((c) => c.isConfigured());
}

function experimentalFlagsPath(): string {
  const envPath = process.env.PULSE_CANVAS_EXPERIMENTAL_FEATURES?.trim();
  return envPath || join(homedir(), '.pulse-coder', 'canvas', 'experimental-features.json');
}

/**
 * Synchronous flag read — `enabledWhen` runs at plugin registration time
 * (before the renderer is up), so we cannot round-trip through IPC. Missing
 * / unparseable file falls through to registry defaults (flag off → plugin
 * inactive). Mirrors the dynamic-app plugin's gating.
 */
function isChannelsFlagEnabled(): boolean {
  let overrides: Record<string, boolean> = {};
  try {
    const raw = readFileSync(experimentalFlagsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'boolean') overrides[k] = v;
      }
    }
  } catch {
    overrides = {};
  }
  return resolveFeatureValues(overrides)[EXPERIMENTAL_FLAG_CHANNELS] === true;
}

let bridge: ChannelBridge | null = null;

/**
 * The "channel" plugin: bridges external messaging channels (Feishu today)
 * to the workspace Canvas Agent, so a conversation can be driven from chat.
 *
 * Gated behind the `chat-channels` experimental flag AND a configured
 * channel — it stays fully inert unless the user has opted in via
 * Settings → Experimental and a channel's credentials are present
 * (e.g. FEISHU_APP_ID / FEISHU_APP_SECRET).
 */
export const ChannelMainPlugin: MainCanvasPlugin = {
  id: 'channel',
  enabledWhen: () => isChannelsFlagEnabled() && anyChannelConfigured(),

  async activate(ctx: MainCtx): Promise<void> {
    const service = ctx.getAgentService();
    bridge = new ChannelBridge(service, ctx.store, {
      activateCanvas: activateWorkspaceWindow,
    });

    for (const channel of allChannels()) {
      if (!channel.isConfigured()) continue;
      try {
        await bridge.addChannel(channel);
        console.log(`[channel] started: ${channel.id}`);
      } catch (err) {
        console.error(`[channel] failed to start ${channel.id}`, err);
      }
    }
  },

  async deactivate(): Promise<void> {
    await bridge?.stop();
    bridge = null;
  },
};
