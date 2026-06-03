import type { AgentScope, CanvasAgentServiceRef } from '../../../types';
import type { InboundMessage } from './types';
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
  '/list — list available workspaces',
  '/ws — show whether this chat is global or bound to a workspace',
  '/bind <number|name|id> — bind this chat to a workspace',
  '/unbind — clear this chat’s binding and return to global chat',
  '/default <name|id> — set the workspace suggested for /bind',
  '/new — start a fresh session',
  '/stop — abort the current run',
  '/sessions — list sessions for this chat’s current scope',
  '/session <number|id> — switch this chat to a session',
  '/open [number|name|id] — open a workspace in the canvas app (for webview ops)',
].join('\n');

const NEED_OPEN_TARGET = 'Usage: /open <number|name|id>  (or bind this chat and use /open).';

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
  return `🔗 Pick a workspace for this chat with /bind <number|name>:\n${lines.join('\n')}`;
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

/**
 * Handle a slash command. Returns the text to reply with when `msg` is a
 * command, or null when it is an ordinary message the bridge should route
 * to the agent. Channel-agnostic — operates purely on the normalized
 * {@link InboundMessage} and the shared service/binding deps.
 */
export async function handleCommand(
  msg: InboundMessage,
  deps: CommandDeps,
): Promise<string | null> {
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
      return HELP;

    case 'list': {
      const workspaces = await listWorkspaces();
      if (workspaces.length === 0) return 'No canvas workspaces found yet.';
      const bound = await bindings.getBound(msg.channelId, msg.conversationId);
      const lines = workspaces.slice(0, 30).map((w, i) => {
        const marks = [
          w.id === bound ? '⭐' : null,
          w.isActive ? '🖥️' : null,
        ].filter(Boolean).join('');
        return `${i + 1}. ${workspaceLabel(w)}${marks ? ` ${marks}` : ''}`;
      });
      return `📋 Workspaces (⭐ bound here · 🖥️ open in app):\n${lines.join('\n')}\n\nBind with /bind <number|name>.`;
    }

    case 'ws':
    case 'whoami': {
      const bound = await bindings.getBound(msg.channelId, msg.conversationId);
      if (bound) return `🎯 This chat is bound to ${await workspaceLabelById(bound)}.`;
      return '🌐 This chat is using Global chat. Use /bind <number|name|id> to pin it to a canvas workspace.';
    }

    case 'bind': {
      // No argument → bind the suggested default, if one is configured.
      const ref = arg || (await bindings.getSuggestedDefault());
      if (!ref) return 'Usage: /bind <number|name|id>  (see /list). No default is set.';
      const id = await resolveWorkspaceRef(ref);
      if (!id) return `Workspace not found: ${ref}. Use /list to see available workspaces.`;
      const previousScope = await currentScope();
      const targetScope = workspaceScope(id);
      await bindings.bind(msg.channelId, msg.conversationId, id);
      const migrated = sameScope(previousScope, targetScope)
        ? { ok: true, messageCount: 0 }
        : await migrateConversationSession(previousScope, targetScope, msg.conversationId, deps);
      const label = await workspaceLabelById(id);
      if (!migrated.ok) {
        return `✅ This chat is now bound to ${label}.\n⚠️ Previous chat context could not be migrated: ${migrated.error ?? 'unknown error'}`;
      }
      const suffix = migrated.messageCount && migrated.messageCount > 0
        ? ` Migrated ${migrated.messageCount} previous messages.`
        : '';
      return `✅ This chat is now bound to ${label}.${suffix}`;
    }

    case 'unbind': {
      await bindings.unbind(msg.channelId, msg.conversationId);
      return '✅ Binding cleared. This chat now uses Global chat.';
    }

    case 'default': {
      if (!arg) return 'Usage: /default <name|id>  (see /list)';
      const id = await resolveWorkspace(arg);
      if (!id) return `Workspace not found: ${arg}. Use /list to see available workspaces.`;
      await bindings.setDefault(id);
      return `✅ Default workspace set to ${await workspaceLabelById(id)} (suggested for /bind).`;
    }

    case 'new': {
      const scope = await currentScope();
      const res = await service.newSessionForScope(scope);
      const sessionId = res.ok ? service.getCurrentSessionIdForScope(scope) : null;
      if (sessionId) {
        await sessionRouter.setConversationSession(scope, msg.conversationId, sessionId);
      }
      return res.ok
        ? `🆕 Started a new session in ${await scopeLabel(scope)}.`
        : `Failed to start a new session: ${res.error}`;
    }

    case 'stop': {
      service.abortScope(await currentScope());
      return '🛑 Stop requested.';
    }

    case 'sessions': {
      const scope = await currentScope();
      const list = await service.listSessionsForScope(scope);
      if (list.length === 0) return 'No sessions yet.';
      const lines = list
        .slice(0, 15)
        .map((s, i) => `${i + 1}. ${s.isCurrent ? '(current) ' : ''}${s.date} — ${s.messageCount} msgs`);
      return `🗂️ Sessions for ${await scopeLabel(scope)}:\n${lines.join('\n')}\n\nSwitch with /session <number>.`;
    }

    case 'session': {
      const scope = await currentScope();
      if (!arg) return 'Usage: /session <number|id>  (see /sessions)';
      const list = await service.listSessionsForScope(scope);
      if (list.length === 0) return 'No sessions yet.';

      const n = Number(arg);
      const target =
        Number.isInteger(n) && n >= 1 && n <= list.length
          ? list[n - 1]
          : list.find((s) => s.sessionId === arg);
      if (!target) return `Session not found: ${arg}. Use /sessions to list.`;

      if (target.isCurrent) {
        // Already current, but make sure this conversation owns it going forward.
        await sessionRouter.setConversationSession(scope, msg.conversationId, target.sessionId);
        return `🎯 Already on session ${target.date} (${target.messageCount} msgs).`;
      }

      const res = await service.loadSessionForScope(scope, target.sessionId);
      if (!res.ok) return `Failed to switch session: ${res.error ?? 'unknown error'}`;
      // Pin the choice so the per-conversation router keeps it on later turns.
      await sessionRouter.setConversationSession(scope, msg.conversationId, target.sessionId);
      return `✅ Switched to session ${target.date} (${target.messageCount} msgs).`;
    }

    case 'open': {
      const workspaceId = arg ? await resolveWorkspaceRef(arg) : await requireBound();
      if (!workspaceId) {
        return arg
          ? `Workspace not found: ${arg}. Use /list to see available workspaces.`
          : NEED_OPEN_TARGET;
      }
      if (!activateCanvas) return 'Opening the canvas app is not available here.';
      const res = await activateCanvas(workspaceId);
      return res.ok
        ? `🖥️ Activated ${await workspaceLabelById(workspaceId)} in the canvas (without stealing focus). ` +
            'Webview/iframe operations should work once the page finishes loading.'
        : `Failed to activate the canvas: ${res.error ?? 'unknown error'}`;
    }

    default:
      return `Unknown command: /${cmd}\n\n${HELP}`;
  }
}
