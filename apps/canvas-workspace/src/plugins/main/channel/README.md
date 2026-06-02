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

The plugin is **inert unless explicitly opted in**. `enabledWhen` requires
**both**:

1. the **`Chat channels (Feishu)`** experimental toggle is on
   (Settings → Experimental), and
2. a channel is configured — either via the Settings panel (stored
   encrypted) or `FEISHU_APP_ID` / `FEISHU_APP_SECRET` env vars.

Toggling the experimental flag takes effect on the next window reload /
relaunch (the flag is read at plugin registration time).

## Feishu setup

1. Create a **self-built app** in the Feishu Open Platform.
2. Event subscription: choose **long-connection (WebSocket)** mode and
   subscribe to `im.message.receive_v1`. No public URL is needed — the
   canvas app dials out, so it works behind NAT.
3. Grant scopes: `im:message` (receive), `im:message:send_as_bot` (send),
   and `im:resource` (image upload, optional).
4. Provide credentials, either way:

   - **From the UI (recommended):** Settings → Experimental → turn on
     **Chat channels (Feishu)**, then fill in App ID / App Secret (and an
     optional default workspace) in the panel that appears. The secret is
     stored encrypted; on the next launch it is folded into the environment.
   - **From env vars:**

     ```bash
     export FEISHU_APP_ID=cli_xxx
     export FEISHU_APP_SECRET=xxx
     # optional: a workspace suggested for `/bind` (not auto-applied)
     export CANVAS_FEISHU_DEFAULT_WORKSPACE=<workspaceId>
     # optional: override the API host
     export FEISHU_API_BASE_URL=https://open.feishu.cn
     ```

   Env vars take precedence over UI-stored values.

5. Turn on **Chat channels (Feishu)** in Settings → Experimental (if not
   already), then **relaunch** Canvas so the plugin activates. The config
   panel offers a "Relaunch now" button after saving.

In a **direct chat** the bot replies to every message. In a **group chat**
it only responds when @-mentioned.

> Availability: the bridge runs inside the desktop app, so it responds while
> the machine is awake (screen off / locked / app in background are all
> fine). It does **not** respond while the machine is asleep/suspended.

## Commands

| Command | Effect |
|---|---|
| `/help` | Show command help |
| `/list` | List workspaces by name (⭐ = bound to this chat, 🖥️ = open in the app) |
| `/ws` | Show which workspace this chat is bound to |
| `/bind <name\|id>` | Bind this chat to a workspace (by friendly name or id) |
| `/unbind` | Clear this chat's binding (fall back to default) |
| `/default <name\|id>` | Set the workspace suggested for `/bind` (not auto-applied) |
| `/new` | Start a fresh session |
| `/stop` | Abort the current run |
| `/sessions` | List sessions (numbered) for the bound workspace |
| `/session <number\|id>` | Switch this chat to a specific session (sticky) |
| `/open` | Activate the bound workspace in the canvas (for webview ops; no focus steal) |

Workspace names come from the Canvas workspace manifest, so `/list` shows
human names (with ids) and `/bind` / `/default` accept either a name or an id.

You can chat **without binding** — an unbound conversation runs in the canvas
**default workspace** (`default`, mirroring the app's always-present default),
so it just works out of the box. Bind a specific workspace later with `/bind`
when you need it.

Binding is **explicit and sticky**: once you `/bind`, that conversation stays
on that workspace and never switches on its own. The unbound fallback is a
fixed id, so it can't surprise-switch mid-chat either. Use `/unbind` to return
a conversation to the default workspace.

The stored/env default is only a **suggestion** for `/bind` with no argument;
it is not the unbound fallback. Bindings persist via the plugin's own store
(`PluginStore`).

## Conversations & topic groups

Each conversation is bound (and addressed) independently:

- a **direct chat** keys on its `chat_id`,
- each **group** keys on its `chat_id`, and
- each **topic in a topic group (话题群)** keys on `chat_id:<topic>` where
  `<topic>` is `thread_id` (falling back to `root_id` so a topic's root and
  its replies stay one conversation) — so different topics in the same group
  are separate conversations **with separate sessions**, and replies are sent
  back **into the right topic** (`reply_in_thread`).

So `/bind` in one topic only affects that topic; another topic (or the DM)
can point at a different workspace.

Reply routing: direct chats get a fresh message; **group** messages (incl.
topic groups) are sent as a **reply to the triggering message**, with
`reply_in_thread` when the conversation is threaded — so the bot's output
stays attached to the user's message / inside the topic rather than landing
on the group root.

### Sessions

Each conversation keeps **its own session/history**, even when several
conversations (a DM, a group, different topics) share one workspace. Canvas
stores a single *current* session per workspace, so the plugin maps
`workspace::conversation → sessionId` and swaps the current session to the
conversation's own before each turn (creating it on first contact). Runs are
serialized per workspace, so the swap can't race another turn. The map
persists, so histories survive restarts.

Trade-offs:

- The workspace's *current* session is shared with the Canvas UI, so the UI
  for that workspace shows whichever conversation ran last (each session is
  intact and selectable in the UI's session list).
- Conversations bound to the same workspace still run one-at-a-time (a second
  in-flight message sees "still working").

### Canvas activation (for webview ops)

Some agent tools need the canvas **UI** open on the workspace — e.g.
webview/iframe page control requires the node's `<webview>` to be mounted in
the renderer. When driving from a channel the window may be hidden or on a
different workspace, so those tools fail with "No active webview…".

`/open` activates the bound workspace in the canvas and navigates to it
**without stealing focus or raising the window**: it only shows the window
(inactively) if it was hidden/minimized — so its renderer isn't suspended and
the webviews can load — and creates the window if none is open. It uses the
renderer's existing `#/?workspaceId=<id>` hash route. Activation is currently
**manual** (send `/open` before webview-dependent requests); automatic
activation on tool failure is a possible follow-up.

### Debugging

Set `CANVAS_CHANNEL_DEBUG=1` before launch to log each raw inbound event
(JSON) plus a parsed summary (`chat_type`, `thread_id`, `root_id`,
`conversationId`). Useful for confirming what Feishu sends in topic groups.

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
