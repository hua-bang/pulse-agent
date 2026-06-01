import type { MainCanvasPlugin, MainCtx } from '../../types';
import { ChannelBridge } from './core/bridge';
import type { Channel } from './core/types';
import { FeishuChannel } from './channels/feishu/feishu-channel';

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

let bridge: ChannelBridge | null = null;

/**
 * The "channel" plugin: bridges external messaging channels (Feishu today)
 * to the workspace Canvas Agent, so a conversation can be driven from chat.
 * Gated by {@link anyChannelConfigured} so it stays fully inert until a
 * channel is configured (e.g. FEISHU_APP_ID / FEISHU_APP_SECRET are set).
 */
export const ChannelMainPlugin: MainCanvasPlugin = {
  id: 'channel',
  enabledWhen: anyChannelConfigured,

  async activate(ctx: MainCtx): Promise<void> {
    const service = ctx.getAgentService();
    bridge = new ChannelBridge(service, ctx.store);

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
