import type { AgentScope, CanvasAgentServiceRef } from '../../../types';
import type { CommandReply, InboundMessage, WorkspacePicker } from './types';
import type { BindingStore } from './binding';
import type { SessionRouter } from './sessions';
import {
  listWorkspaces,
  resolveWorkspace,
  resolveWorkspaceRef,
  workspaceLabel,
  workspaceLabelById,
} from './workspaces';

export interface CommandDeps {
  bindings: BindingStore;
  service: CanvasAgentServiceRef;
  sessionRouter: SessionRouter;
  /**
   * Bring the canvas app to the front and open a workspace, for operations
   * that need the UI (e.g. webview/iframe page control). Optional — absent in
   * headless contexts.
   */
  activateCanvas?: (workspaceId: string) => Promise<{ ok: boolean; error?: string }>;
}

const HELP = [
  '🛠️ Canvas channel commands:',
  '/use [number|name|id] [--carry|--fresh] — choose or use a workspace here',
  '/list — choose a workspace',
  '/ws — show whether this chat is global or bound to a workspace',
  '/bind <number|name|id> — bind this chat to a workspace',
  '/unbind — clear this chat’s binding and return to global chat',
  '/default <name|id> — set the workspace suggested for /use and /bind',
  '/new — start a fresh session',
  '/stop — abort the current run',
  '/sessions — list sessions for this chat’s current scope',
  '/session <number|id> — switch this chat to a session',
  '/open [number|name|id] — open a workspace in the canvas app (for webview ops)',
].join('\n');

const NEED_OPEN_TARGET = 'Usage: /open <number|name|id>  (or bind this chat and use /open).';
const NEED_USE_TARGET = 'Usage: /use <number|name|id> [--carry|--fresh]  (or send /use to choose).';

/**
 * Numbered workspace picker shown when a conversation needs to bind. The
 * numbers match {@link listWorkspaces} order (and /list), so the user can bind
 * by replying with a single digit. Shared by the bridge's first-contact prompt.
 */
export async function buildBindPrompt(): Promise<string> {
  const workspaces = await listWorkspaces();
  if (workspaces.length === 0) {
    return (
      '🔗 This chat isn’t bound to a workspace, and no canvas workspaces exist yet. ' +
      'Create one in the canvas app, then send your message again.'
    );
  }
  const lines = workspaces
    .slice(0, 30)
    .map((w, i) => `${i + 1}. ${workspaceLabel(w)}${w.isActive ? ' 🖥️' : ''}`);
  return `🔗 Pick a workspace for this chat with /use <number|name>:\n${lines.join('\n')}`;
}

function workspaceScope(workspaceId: string): AgentScope {
  return { kind: 'workspace', workspaceId };
}

function sameScope(a: AgentScope, b: AgentScope): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'global' || a.workspaceId === (b as { kind: 'workspace'; workspaceId: string }).workspaceId;
}

async function scopeLabel(scope: AgentScope): Promise<string> {
  return scope.kind === 'global' ? 'Global chat' : workspaceLabelById(scope.workspaceId);
}

async function migrateConversationSession(
  sourceScope: AgentScope,
  targetScope: AgentScope,
  conversationId: string,
  deps: CommandDeps,
): Promise<{ ok: boolean; messageCount?: number; error?: string }> {
  const sourceSessionId = await deps.sessionRouter.getConversationSessionId(sourceScope, conversationId);
  if (!sourceSessionId) return { ok: true, messageCount: 0 };

  const copied = await deps.service.copySessionToScope(sourceScope, sourceSessionId, targetScope);
  if (!copied.ok) return { ok: false, error: copied.error };
  if (copied.sessionId) {
    await deps.sessionRouter.setConversationSession(targetScope, conversationId, copied.sessionId);
  }
  return { ok: true, messageCount: copied.messageCount ?? 0 };
}

interface UseArgs {
  ref: string;
  carry: boolean;
  fresh: boolean;
}

interface WorkspaceUseResult {
  label: string;
  contextSuffix: string;
  migratedMessageCount?: number;
  warning?: string;
}

interface WorkspacePickerReplyOptions {
  defaultCarry?: boolean;
  summary?: string;
}

function textReply(text: string): CommandReply {
  return { kind: 'text', text };
}

function parseUseArgs(parts: string[]): UseArgs {
  const refParts: string[] = [];
  let carry = false;
  let fresh = false;
  for (const part of parts) {
    if (part === '--carry') {
      carry = true;
      continue;
    }
    if (part === '--fresh' || part === '--new') {
      fresh = true;
      continue;
    }
    refParts.push(part);
  }
  return { ref: refParts.join(' ').trim(), carry, fresh };
}

function defaultCarryForUse(msg: InboundMessage, previousWorkspaceId?: string): boolean {
  return !msg.isDirect && !previousWorkspaceId;
}

export async function buildWorkspacePickerReply(
  msg: InboundMessage,
  deps: CommandDeps,
  replyOptions: WorkspacePickerReplyOptions = {},
): Promise<CommandReply> {
  const workspaces = await listWorkspaces();
  if (workspaces.length === 0) {
    return textReply('No canvas workspaces found yet.');
  }

  const bound = await deps.bindings.getBound(msg.channelId, msg.conversationId);
  const defaultCarry = replyOptions.defaultCarry ?? defaultCarryForUse(msg, bound);
  const options = workspaces.slice(0, 30).map((w) => ({
    id: w.id,
    label: workspaceLabel(w),
    isActive: w.isActive,
    isBound: w.id === bound,
  }));
  const current = replyOptions.summary ??
    (bound
      ? `Current chat: bound to ${await workspaceLabelById(bound)}.`
      : 'Current chat: not connected to a workspace.');
  const carry = defaultCarry
    ? 'By default, Pulse will bring the recent discussion into the chosen workspace.'
    : 'By default, Pulse will use that workspace’s own conversation.';
  const lines = options.map((w, i) => {
    const marks = [
      w.isBound ? '⭐' : null,
      w.isActive ? '🖥️' : null,
    ].filter(Boolean).join('');
    return `${i + 1}. ${w.label}${marks ? ` ${marks}` : ''}`;
  });
  const fallbackText = [
    '📋 Choose a workspace (⭐ bound here · 🖥️ open in app):',
    ...lines,
    '',
    `${current} ${carry}`,
    '',
    'Use with /use <number|name>. Add --carry to bring the recent discussion.',
  ].join('\n');

  const picker: WorkspacePicker = {
    title: 'Choose a workspace',
    summary: `${current} ${carry}`,
    options,
    defaultCarry,
    fallbackText,
  };
  return { kind: 'workspace_picker', picker };
}

async function bindConversationToWorkspace(
  msg: InboundMessage,
  deps: CommandDeps,
  workspaceId: string,
  options: { carry?: boolean; fresh?: boolean; forceMigrate?: boolean } = {},
): Promise<WorkspaceUseResult> {
  const previousWorkspaceId = await deps.bindings.getBound(msg.channelId, msg.conversationId);
  const previousScope: AgentScope = previousWorkspaceId
    ? workspaceScope(previousWorkspaceId)
    : { kind: 'global' };
  const targetScope: AgentScope = workspaceScope(workspaceId);
  await deps.bindings.bind(msg.channelId, msg.conversationId, workspaceId);

  const label = await workspaceLabelById(workspaceId);
  if (options.fresh) {
    const res = await deps.service.newSessionForScope(targetScope);
    if (!res.ok) {
      return {
        label,
        contextSuffix: '',
        warning: `Fresh session could not be started: ${res.error ?? 'unknown error'}`,
      };
    }
    const sessionId = deps.service.getCurrentSessionIdForScope(targetScope);
    if (sessionId) {
      await deps.sessionRouter.setConversationSession(targetScope, msg.conversationId, sessionId);
    }
    return { label, contextSuffix: ' Started a fresh session.' };
  }

  const shouldMigrate = options.forceMigrate ?? Boolean(options.carry);
  if (!shouldMigrate || sameScope(previousScope, targetScope)) {
    return { label, contextSuffix: '' };
  }

  const migrated = await migrateConversationSession(previousScope, targetScope, msg.conversationId, deps);
  if (!migrated.ok) {
    return {
      label,
      contextSuffix: '',
      warning: `Previous chat context could not be migrated: ${migrated.error ?? 'unknown error'}`,
    };
  }
  const contextSuffix = migrated.messageCount && migrated.messageCount > 0
    ? ` Brought over ${migrated.messageCount} previous messages.`
    : '';
  return { label, contextSuffix, migratedMessageCount: migrated.messageCount ?? 0 };
}

/**
 * Handle a slash command. Returns the text to reply with when `msg` is a
 * command, or null when it is an ordinary message the bridge should route
 * to the agent. Channel-agnostic — operates purely on the normalized
 * {@link InboundMessage} and the shared service/binding deps.
 */
export async function handleCommand(
  msg: InboundMessage,
  deps: CommandDeps,
): Promise<CommandReply | null> {
  const text = msg.text.trim();
  if (!text.startsWith('/')) return null;

  const [rawCmd, ...rest] = text.slice(1).split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const arg = rest.join(' ').trim();
  const { bindings, service, sessionRouter, activateCanvas } = deps;

  const requireBound = () => bindings.getBound(msg.channelId, msg.conversationId);
  const currentScope = async (): Promise<AgentScope> => {
    const workspaceId = await requireBound();
    return workspaceId ? workspaceScope(workspaceId) : { kind: 'global' };
  };

  switch (cmd) {
    case 'help':
      return textReply(HELP);

    case 'list': {
      return buildWorkspacePickerReply(msg, deps);
    }

    case 'ws':
    case 'whoami': {
      const bound = await bindings.getBound(msg.channelId, msg.conversationId);
      if (bound) return textReply(`🎯 This chat is bound to ${await workspaceLabelById(bound)}.`);
      return textReply('🌐 This chat is not connected to a workspace. Send /use to choose one.');
    }

    case 'bind': {
      // No argument → bind the suggested default, if one is configured.
      const ref = arg || (await bindings.getSuggestedDefault());
      if (!ref) return textReply('Usage: /bind <number|name|id>  (see /list). No default is set.');
      const id = await resolveWorkspaceRef(ref);
      if (!id) return textReply(`Workspace not found: ${ref}. Use /list to see available workspaces.`);
      const bound = await bindConversationToWorkspace(msg, deps, id, { forceMigrate: true });
      if (bound.warning) {
        return textReply(`✅ This chat is now bound to ${bound.label}.\n⚠️ ${bound.warning}`);
      }
      const suffix = bound.migratedMessageCount && bound.migratedMessageCount > 0
        ? ` Migrated ${bound.migratedMessageCount} previous messages.`
        : '';
      return textReply(`✅ This chat is now bound to ${bound.label}.${suffix}`);
    }

    case 'use': {
      const parsed = parseUseArgs(rest);
      if (!parsed.ref) {
        return buildWorkspacePickerReply(msg, deps);
      }
      const id = await resolveWorkspaceRef(parsed.ref);
      if (!id) return textReply(`Workspace not found: ${parsed.ref}. Use /list to see available workspaces.`);

      const previousWorkspaceId = await bindings.getBound(msg.channelId, msg.conversationId);
      const carry = parsed.carry || (!parsed.fresh && defaultCarryForUse(msg, previousWorkspaceId));
      const used = await bindConversationToWorkspace(msg, deps, id, {
        carry,
        fresh: parsed.fresh,
      });
      const prefix = parsed.fresh ? 'Using fresh session in' : 'Using';
      if (!activateCanvas) {
        return textReply(
          `✅ ${prefix} ${used.label}.${used.contextSuffix}\n` +
          `⚠️ Opening the canvas app is not available here.${used.warning ? `\n⚠️ ${used.warning}` : ''}`,
        );
      }

      const res = await activateCanvas(id);
      const openLine = res.ok
        ? `✅ ${prefix} ${used.label}. Opened in Canvas.${used.contextSuffix}`
        : `✅ ${prefix} ${used.label}.${used.contextSuffix}\n⚠️ Failed to open Canvas: ${res.error ?? 'unknown error'}`;
      return textReply(used.warning ? `${openLine}\n⚠️ ${used.warning}` : openLine);
    }

    case 'unbind': {
      await bindings.unbind(msg.channelId, msg.conversationId);
      return textReply('✅ Binding cleared. This chat is no longer connected to a workspace.');
    }

    case 'default': {
      if (!arg) return textReply('Usage: /default <name|id>  (see /list)');
      const id = await resolveWorkspace(arg);
      if (!id) return textReply(`Workspace not found: ${arg}. Use /list to see available workspaces.`);
      await bindings.setDefault(id);
      return textReply(`✅ Default workspace set to ${await workspaceLabelById(id)} (suggested for /use and /bind).`);
    }

    case 'new': {
      const scope = await currentScope();
      const res = await service.newSessionForScope(scope);
      const sessionId = res.ok ? service.getCurrentSessionIdForScope(scope) : null;
      if (sessionId) {
        await sessionRouter.setConversationSession(scope, msg.conversationId, sessionId);
      }
      return textReply(res.ok
        ? `🆕 Started a new session in ${await scopeLabel(scope)}.`
        : `Failed to start a new session: ${res.error}`);
    }

    case 'stop': {
      service.abortScope(await currentScope());
      return textReply('🛑 Stop requested.');
    }

    case 'sessions': {
      const scope = await currentScope();
      const list = await service.listSessionsForScope(scope);
      if (list.length === 0) return textReply('No sessions yet.');
      const lines = list
        .slice(0, 15)
        .map((s, i) => `${i + 1}. ${s.isCurrent ? '(current) ' : ''}${s.date} — ${s.messageCount} msgs`);
      return textReply(`🗂️ Sessions for ${await scopeLabel(scope)}:\n${lines.join('\n')}\n\nSwitch with /session <number>.`);
    }

    case 'session': {
      const scope = await currentScope();
      if (!arg) return textReply('Usage: /session <number|id>  (see /sessions)');
      const list = await service.listSessionsForScope(scope);
      if (list.length === 0) return textReply('No sessions yet.');

      const n = Number(arg);
      const target =
        Number.isInteger(n) && n >= 1 && n <= list.length
          ? list[n - 1]
          : list.find((s) => s.sessionId === arg);
      if (!target) return textReply(`Session not found: ${arg}. Use /sessions to list.`);

      if (target.isCurrent) {
        // Already current, but make sure this conversation owns it going forward.
        await sessionRouter.setConversationSession(scope, msg.conversationId, target.sessionId);
        return textReply(`🎯 Already on session ${target.date} (${target.messageCount} msgs).`);
      }

      const res = await service.loadSessionForScope(scope, target.sessionId);
      if (!res.ok) return textReply(`Failed to switch session: ${res.error ?? 'unknown error'}`);
      // Pin the choice so the per-conversation router keeps it on later turns.
      await sessionRouter.setConversationSession(scope, msg.conversationId, target.sessionId);
      return textReply(`✅ Switched to session ${target.date} (${target.messageCount} msgs).`);
    }

    case 'open': {
      const workspaceId = arg ? await resolveWorkspaceRef(arg) : await requireBound();
      if (!workspaceId) {
        return textReply(arg
          ? `Workspace not found: ${arg}. Use /list to see available workspaces.`
          : NEED_OPEN_TARGET);
      }
      if (!activateCanvas) return textReply('Opening the canvas app is not available here.');
      const res = await activateCanvas(workspaceId);
      return textReply(res.ok
        ? `🖥️ Activated ${await workspaceLabelById(workspaceId)} in the canvas (without stealing focus). ` +
            'Webview/iframe operations should work once the page finishes loading.'
        : `Failed to activate the canvas: ${res.error ?? 'unknown error'}`);
    }

    default:
      return textReply(`Unknown command: /${cmd}\n\n${HELP}`);
  }
}
