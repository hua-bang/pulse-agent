// Channel-agnostic contracts. A "channel" is an external messaging surface
// (Feishu today; Discord / Telegram / WeCom later) that delivers inbound
// messages from a user and renders the agent's streamed output back. The
// orchestration in `bridge.ts` speaks only this vocabulary — it has no
// knowledge of any concrete channel.

/** A normalized inbound message, produced by a channel from its raw event. */
export interface InboundMessage {
  /** Owning channel id, e.g. 'feishu'. */
  channelId: string;
  /**
   * Stable *logical* conversation identifier — the unit a binding / session
   * attaches to. A channel decides its granularity: a Feishu direct chat and
   * each group are distinct chats, and each topic within a topic group is its
   * own conversation (chat_id + thread_id).
   */
  conversationId: string;
  /** Sender identity within the channel (Feishu open_id). */
  userId: string;
  /** Channel-unique message id, used for idempotent dedupe. */
  messageId: string;
  /** Plain-text body, already trimmed and stripped of bot @-mentions. */
  text: string;
  /** True when this is a group message that @-mentioned the bot. */
  isMention: boolean;
  /** True for 1:1 / direct conversations. */
  isDirect: boolean;
  /**
   * Opaque, channel-defined routing info for replies (e.g. Feishu chat_id +
   * thread_id + the triggering message id, so replies land in the right
   * topic). The core shuttles this back via {@link OutboundTarget} without
   * interpreting it.
   */
  reply: unknown;
}

/** Where to send output back. Carries the inbound conversation's reply routing. */
export interface OutboundTarget {
  conversationId: string;
  /** Opaque channel-defined reply routing, copied from the inbound message. */
  reply: unknown;
}

export interface WorkspacePickerOption {
  id: string;
  label: string;
  isActive: boolean;
  isBound: boolean;
}

export interface WorkspacePicker {
  title: string;
  summary: string;
  options: WorkspacePickerOption[];
  defaultCarry: boolean;
  fallbackText: string;
}

export type CommandReply =
  | { kind: 'text'; text: string }
  | { kind: 'workspace_picker'; picker: WorkspacePicker };

/**
 * A live output sink for a single agent run. The channel decides how each
 * event renders (Feishu progressively patches one interactive card). All
 * methods may be async; callers await them so a channel can serialize its
 * own writes.
 */
export interface ChannelStream {
  onText(delta: string): void | Promise<void>;
  onToolCall(name: string, args: unknown): void | Promise<void>;
  onToolResult?(result: { name: string; result: string }): void | Promise<void>;
  onImage?(imagePath: string, mimeType?: string): void | Promise<void>;
  onClarification(question: string): void | Promise<void>;
  onDone(text: string): void | Promise<void>;
  onError(message: string): void | Promise<void>;
}

/** Handler the bridge installs to receive a channel's inbound traffic. */
export type InboundHandler = (msg: InboundMessage) => void;

/**
 * A concrete messaging channel. Implementations own all platform I/O
 * (connecting, parsing events into {@link InboundMessage}, sending replies).
 */
export interface Channel {
  /** Stable id, e.g. 'feishu'. */
  readonly id: string;
  /** True when the channel has the credentials/config it needs to run. */
  isConfigured(): boolean;
  /** Begin receiving events, routing each to `onInbound`. */
  start(onInbound: InboundHandler): Promise<void>;
  /** Release the connection and any resources. Safe to call when stopped. */
  stop(): Promise<void>;
  /** Open a streaming output sink for one agent run. */
  openStream(target: OutboundTarget): Promise<ChannelStream>;
  /** Send a one-off plain-text reply (command output, pre-run notices). */
  sendText(target: OutboundTarget, text: string): Promise<void>;
  /** Send a workspace picker. Channels without rich UI can omit this. */
  sendWorkspacePicker?(target: OutboundTarget, picker: WorkspacePicker): Promise<void>;
}
