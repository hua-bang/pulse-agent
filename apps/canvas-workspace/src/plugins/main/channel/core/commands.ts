import type { CanvasAgentServiceRef } from '../../../types';
import type { InboundMessage } from './types';
import type { BindingStore } from './binding';
import {
  listWorkspaces,
  resolveWorkspace,
  workspaceLabel,
  workspaceLabelById,
} from './workspaces';

export interface CommandDeps {
  bindings: BindingStore;
  service: CanvasAgentServiceRef;
}

const HELP = [
  '🛠️ Canvas channel commands:',
  '/list — list available workspaces',
  '/ws — show the workspace this chat is bound to',
  '/bind <name|id> — bind this chat to a workspace',
  '/unbind — clear this chat’s binding (fall back to default)',
  '/default <name|id> — set the global default workspace',
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
      const lines = workspaces.slice(0, 30).map((w) => {
        const marks = [
          w.id === current ? '⭐' : null,
          w.isActive ? '🖥️' : null,
        ].filter(Boolean).join('');
        return `• ${workspaceLabel(w)}${marks ? ` ${marks}` : ''}`;
      });
      return `📋 Workspaces (⭐ this chat · 🖥️ open in app):\n${lines.join('\n')}`;
    }

    case 'ws':
    case 'whoami': {
      const explicit = await bindings.getExplicit(msg.channelId, msg.conversationId);
      const resolved = await bindings.resolve(msg.channelId, msg.conversationId);
      if (!resolved) return 'No workspace bound and none found on disk. Use /bind <name|id>.';
      const how = explicit ? 'bound to this chat' : 'resolved (default/fallback)';
      return `🎯 This chat → ${await workspaceLabelById(resolved)}\n(${how})`;
    }

    case 'bind': {
      if (!arg) return 'Usage: /bind <name|id>  (see /list)';
      const id = await resolveWorkspace(arg);
      if (!id) return `Workspace not found: ${arg}. Use /list to see available workspaces.`;
      await bindings.bind(msg.channelId, msg.conversationId, id);
      return `✅ This chat is now bound to ${await workspaceLabelById(id)}.`;
    }

    case 'unbind': {
      await bindings.unbind(msg.channelId, msg.conversationId);
      const fallback = await bindings.resolve(msg.channelId, msg.conversationId);
      return fallback
        ? `✅ Binding cleared. This chat now falls back to ${await workspaceLabelById(fallback)}.`
        : '✅ Binding cleared.';
    }

    case 'default': {
      if (!arg) return 'Usage: /default <name|id>  (see /list)';
      const id = await resolveWorkspace(arg);
      if (!id) return `Workspace not found: ${arg}. Use /list to see available workspaces.`;
      await bindings.setDefault(id);
      return `✅ Default workspace set to ${await workspaceLabelById(id)}.`;
    }

    case 'new': {
      const workspaceId = await bindings.resolve(msg.channelId, msg.conversationId);
      if (!workspaceId) return 'No workspace bound. Use /bind <name|id> first.';
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
      if (!workspaceId) return 'No workspace bound. Use /bind <name|id> first.';
      const sessions = await service.listSessions(workspaceId);
      if (sessions.length === 0) return 'No sessions yet.';
      const lines = sessions
        .slice(0, 15)
        .map((s) => `${s.isCurrent ? '• (current) ' : '• '}${s.date} — ${s.messageCount} msgs`);
      return `🗂️ Sessions for ${await workspaceLabelById(workspaceId)}:\n${lines.join('\n')}`;
    }

    default:
      return `Unknown command: /${cmd}\n\n${HELP}`;
  }
}
