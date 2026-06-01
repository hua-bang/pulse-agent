import type { CanvasAgentServiceRef } from '../../../types';
import type { InboundMessage } from './types';
import type { BindingStore } from './binding';
import { listWorkspaces, workspaceExists } from './workspaces';

export interface CommandDeps {
  bindings: BindingStore;
  service: CanvasAgentServiceRef;
}

const HELP = [
  '🛠️ Canvas channel commands:',
  '/list — list available workspaces',
  '/ws — show the workspace this chat is bound to',
  '/bind <workspaceId> — bind this chat to a workspace',
  '/unbind — clear this chat’s binding (fall back to default)',
  '/default <workspaceId> — set the global default workspace',
  '/new — start a fresh session',
  '/stop — abort the current run',
  '/sessions — list sessions for the bound workspace',
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
  const { bindings, service } = deps;

  switch (cmd) {
    case 'help':
      return HELP;

    case 'list': {
      const workspaces = await listWorkspaces();
      if (workspaces.length === 0) return 'No canvas workspaces found yet.';
      const current = await bindings.resolve(msg.channelId, msg.conversationId);
      const lines = workspaces
        .slice(0, 30)
        .map((w) => `${w.id === current ? '• (current) ' : '• '}${w.id}`);
      return `📋 Workspaces:\n${lines.join('\n')}`;
    }

    case 'ws':
    case 'whoami': {
      const explicit = await bindings.getExplicit(msg.channelId, msg.conversationId);
      const resolved = await bindings.resolve(msg.channelId, msg.conversationId);
      if (!resolved) return 'No workspace bound and none found on disk. Use /bind <workspaceId>.';
      const how = explicit ? 'bound to this chat' : 'resolved (default/fallback)';
      return `🎯 This chat → ${resolved}\n(${how})`;
    }

    case 'bind': {
      if (!arg) return 'Usage: /bind <workspaceId>  (see /list)';
      if (!(await workspaceExists(arg))) {
        return `Workspace not found: ${arg}. Use /list to see available workspaces.`;
      }
      await bindings.bind(msg.channelId, msg.conversationId, arg);
      return `✅ This chat is now bound to ${arg}.`;
    }

    case 'unbind': {
      await bindings.unbind(msg.channelId, msg.conversationId);
      const fallback = await bindings.resolve(msg.channelId, msg.conversationId);
      return fallback
        ? `✅ Binding cleared. This chat now falls back to ${fallback}.`
        : '✅ Binding cleared.';
    }

    case 'default': {
      if (!arg) return 'Usage: /default <workspaceId>  (see /list)';
      if (!(await workspaceExists(arg))) {
        return `Workspace not found: ${arg}. Use /list to see available workspaces.`;
      }
      await bindings.setDefault(arg);
      return `✅ Default workspace set to ${arg}.`;
    }

    case 'new': {
      const workspaceId = await bindings.resolve(msg.channelId, msg.conversationId);
      if (!workspaceId) return 'No workspace bound. Use /bind <workspaceId> first.';
      const res = await service.newSession(workspaceId);
      return res.ok ? '🆕 Started a new session.' : `Failed to start a new session: ${res.error}`;
    }

    case 'stop': {
      const workspaceId = await bindings.resolve(msg.channelId, msg.conversationId);
      if (!workspaceId) return 'No workspace bound.';
      service.abort(workspaceId);
      return '🛑 Stop requested.';
    }

    case 'sessions': {
      const workspaceId = await bindings.resolve(msg.channelId, msg.conversationId);
      if (!workspaceId) return 'No workspace bound. Use /bind <workspaceId> first.';
      const sessions = await service.listSessions(workspaceId);
      if (sessions.length === 0) return 'No sessions yet.';
      const lines = sessions
        .slice(0, 15)
        .map((s) => `${s.isCurrent ? '• (current) ' : '• '}${s.date} — ${s.messageCount} msgs`);
      return `🗂️ Sessions for ${workspaceId}:\n${lines.join('\n')}`;
    }

    default:
      return `Unknown command: /${cmd}\n\n${HELP}`;
  }
}
