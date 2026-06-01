import type { CanvasAgentServiceRef } from '../../../types';
import type { InboundMessage } from './types';
import type { BindingStore } from './binding';
import type { SessionRouter } from './sessions';
import {
  listWorkspaces,
  resolveWorkspace,
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
  '/ws — show the workspace this chat is bound to',
  '/bind <name|id> — bind this chat to a workspace',
  '/unbind — clear this chat’s binding',
  '/default <name|id> — set the workspace suggested for /bind',
  '/new — start a fresh session',
  '/stop — abort the current run',
  '/sessions — list sessions for the bound workspace',
  '/session <number|id> — switch this chat to a session',
  '/open — open the bound workspace in the canvas app (for webview ops)',
].join('\n');

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

  switch (cmd) {
    case 'help':
      return HELP;

    case 'list': {
      const workspaces = await listWorkspaces();
      if (workspaces.length === 0) return 'No canvas workspaces found yet.';
      const bound = await bindings.getBound(msg.channelId, msg.conversationId);
      const lines = workspaces.slice(0, 30).map((w) => {
        const marks = [
          w.id === bound ? '⭐' : null,
          w.isActive ? '🖥️' : null,
        ].filter(Boolean).join('');
        return `• ${workspaceLabel(w)}${marks ? ` ${marks}` : ''}`;
      });
      return `📋 Workspaces (⭐ bound here · 🖥️ open in app):\n${lines.join('\n')}\n\nBind with /bind <name|id>.`;
    }

    case 'ws':
    case 'whoami': {
      const bound = await bindings.getBound(msg.channelId, msg.conversationId);
      if (bound) return `🎯 This chat is bound to ${await workspaceLabelById(bound)}.`;
      const suggestion = await bindings.getSuggestedDefault();
      const tip = suggestion
        ? ` Default is ${await workspaceLabelById(suggestion)} — /bind to use it.`
        : '';
      return `🔗 This chat isn't bound to a workspace yet. Use /list then /bind <name|id>.${tip}`;
    }

    case 'bind': {
      // No argument → bind the suggested default, if one is configured.
      const ref = arg || (await bindings.getSuggestedDefault());
      if (!ref) return 'Usage: /bind <name|id>  (see /list). No default is set.';
      const id = await resolveWorkspace(ref);
      if (!id) return `Workspace not found: ${ref}. Use /list to see available workspaces.`;
      await bindings.bind(msg.channelId, msg.conversationId, id);
      return `✅ This chat is now bound to ${await workspaceLabelById(id)}.`;
    }

    case 'unbind': {
      await bindings.unbind(msg.channelId, msg.conversationId);
      return '✅ Binding cleared. This chat is now unbound — /bind to use it again.';
    }

    case 'default': {
      if (!arg) return 'Usage: /default <name|id>  (see /list)';
      const id = await resolveWorkspace(arg);
      if (!id) return `Workspace not found: ${arg}. Use /list to see available workspaces.`;
      await bindings.setDefault(id);
      return `✅ Default workspace set to ${await workspaceLabelById(id)} (suggested for /bind).`;
    }

    case 'new': {
      const workspaceId = await bindings.getBound(msg.channelId, msg.conversationId);
      if (!workspaceId) return 'No workspace bound. Use /bind <name|id> first.';
      const res = await service.newSession(workspaceId);
      return res.ok ? '🆕 Started a new session.' : `Failed to start a new session: ${res.error}`;
    }

    case 'stop': {
      const workspaceId = await bindings.getBound(msg.channelId, msg.conversationId);
      if (!workspaceId) return 'No workspace bound.';
      service.abort(workspaceId);
      return '🛑 Stop requested.';
    }

    case 'sessions': {
      const workspaceId = await bindings.getBound(msg.channelId, msg.conversationId);
      if (!workspaceId) return 'No workspace bound. Use /bind <name|id> first.';
      const list = await service.listSessions(workspaceId);
      if (list.length === 0) return 'No sessions yet.';
      const lines = list
        .slice(0, 15)
        .map((s, i) => `${i + 1}. ${s.isCurrent ? '(current) ' : ''}${s.date} — ${s.messageCount} msgs`);
      return `🗂️ Sessions for ${await workspaceLabelById(workspaceId)}:\n${lines.join('\n')}\n\nSwitch with /session <number>.`;
    }

    case 'session': {
      const workspaceId = await bindings.getBound(msg.channelId, msg.conversationId);
      if (!workspaceId) return 'No workspace bound. Use /bind <name|id> first.';
      if (!arg) return 'Usage: /session <number|id>  (see /sessions)';
      const list = await service.listSessions(workspaceId);
      if (list.length === 0) return 'No sessions yet.';

      const n = Number(arg);
      const target =
        Number.isInteger(n) && n >= 1 && n <= list.length
          ? list[n - 1]
          : list.find((s) => s.sessionId === arg);
      if (!target) return `Session not found: ${arg}. Use /sessions to list.`;

      if (target.isCurrent) {
        // Already current, but make sure this conversation owns it going forward.
        await sessionRouter.setConversationSession(workspaceId, msg.conversationId, target.sessionId);
        return `🎯 Already on session ${target.date} (${target.messageCount} msgs).`;
      }

      const res = await service.loadSession(workspaceId, target.sessionId);
      if (!res.ok) return `Failed to switch session: ${res.error ?? 'unknown error'}`;
      // Pin the choice so the per-conversation router keeps it on later turns.
      await sessionRouter.setConversationSession(workspaceId, msg.conversationId, target.sessionId);
      return `✅ Switched to session ${target.date} (${target.messageCount} msgs).`;
    }

    case 'open': {
      const workspaceId = await bindings.getBound(msg.channelId, msg.conversationId);
      if (!workspaceId) return 'No workspace bound. Use /bind <name|id> first.';
      if (!activateCanvas) return 'Opening the canvas app is not available here.';
      const res = await activateCanvas(workspaceId);
      return res.ok
        ? `🖥️ Opened ${await workspaceLabelById(workspaceId)} in the canvas app. ` +
            'Webview/iframe operations should work once the page finishes loading.'
        : `Failed to open the canvas: ${res.error ?? 'unknown error'}`;
    }

    default:
      return `Unknown command: /${cmd}\n\n${HELP}`;
  }
}
