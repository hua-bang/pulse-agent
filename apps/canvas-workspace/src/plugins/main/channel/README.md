# Channel plugin

Bridges external messaging **channels** to the workspace Canvas Agent, so a
conversation can be driven from chat. Feishu (Lark) is the first channel;
the orchestration core is channel-agnostic, so adding Discord / Telegram /
WeCom later is a matter of implementing one interface.

## What it does

- Connects to a channel and receives inbound messages.
- Resolves which canvas workspace a conversation talks to (**default +
  switchable** binding).
- Drives `CanvasAgentService.chat()` for that workspace and streams the
  agent's output back into the channel (Feishu: a single interactive card
  that is progressively patched; images are sent as separate messages).
- Supports clarification round-trips, abort, and session commands.

The plugin is **inert unless a channel is configured** — `enabledWhen`
checks for channel credentials, so with no `FEISHU_*` env vars set nothing
starts.

## Feishu setup

1. Create a **self-built app** in the Feishu Open Platform.
2. Event subscription: choose **long-connection (WebSocket)** mode and
   subscribe to `im.message.receive_v1`. No public URL is needed — the
   canvas app dials out, so it works behind NAT.
3. Grant scopes: `im:message` (receive), `im:message:send_as_bot` (send),
   and `im:resource` (image upload, optional).
4. Set environment variables before launching Canvas:

   ```bash
   export FEISHU_APP_ID=cli_xxx
   export FEISHU_APP_SECRET=xxx
   # optional: pin the default workspace (else most-recently-modified wins)
   export CANVAS_FEISHU_DEFAULT_WORKSPACE=<workspaceId>
   # optional: override the API host
   export FEISHU_API_BASE_URL=https://open.feishu.cn
   ```

In a **direct chat** the bot replies to every message. In a **group chat**
it only responds when @-mentioned.

> Availability: the bridge runs inside the desktop app, so it responds while
> the machine is awake (screen off / locked / app in background are all
> fine). It does **not** respond while the machine is asleep/suspended.

## Commands

| Command | Effect |
|---|---|
| `/help` | Show command help |
| `/list` | List available workspaces (marks the current one) |
| `/ws` | Show which workspace this chat is bound to |
| `/bind <workspaceId>` | Bind this chat to a workspace |
| `/unbind` | Clear this chat's binding (fall back to default) |
| `/default <workspaceId>` | Set the global default workspace |
| `/new` | Start a fresh session |
| `/stop` | Abort the current run |
| `/sessions` | List sessions for the bound workspace |

Workspace binding precedence: explicit chat binding → stored default →
`CANVAS_FEISHU_DEFAULT_WORKSPACE` → most-recently-modified workspace.
Bindings persist via the plugin's own store (`PluginStore`).

## Architecture

```
core/                channel-agnostic orchestration
  types.ts           Channel / InboundMessage / ChannelStream contracts
  bridge.ts          inbound → resolve binding → service.chat() → stream out
  binding.ts         (channelId, conversationId) → workspaceId, persisted
  commands.ts        slash-command handling
  dedupe.ts          message-id LRU dedupe
  image-result.ts    detect generated-image tool results for relay
  workspaces.ts      enumerate canvas workspaces on disk
channels/
  feishu/            first concrete channel
    feishu-channel.ts  WSClient long-connection + card ChannelStream
    feishu-client.ts   Lark SDK message/card/image helpers
    card.ts            interactive-card builders + tool hints
index.ts             ChannelMainPlugin (registered in built-in.ts)
```

## Adding a channel

1. Implement `Channel` (`core/types.ts`): `start`, `stop`, `openStream`,
   `sendText`, `isConfigured`. Parse the platform's events into
   `InboundMessage` and render `ChannelStream` events however the platform
   allows.
2. Add it to `allChannels()` in `index.ts`.

The core (`bridge.ts`, binding, commands, dedupe) needs no changes — it only
speaks the channel-agnostic contracts.

## Host integration

The plugin relies on two small extension points on the canvas plugin system:

- `MainCtx.getAgentService()` — drive conversations via the host's
  `CanvasAgentService` singleton (injected by the host in `bootstrap.ts`).
- `MainCanvasPlugin.deactivate()` — release the long-lived channel
  connection on app shutdown (invoked from `window-all-closed`).

This plugin is self-contained and does **not** depend on `apps/remote-server`;
the Feishu helpers are copied, not imported.
