import { sessionStore } from '../../session-store.js';
import type { CommandResult } from '../types.js';
import { formatTime } from '../utils.js';

/**
 * /merge <session_id> [label]  — link a session to current
 * /merge list                  — list linked sessions
 * /merge remove <session_id>   — unlink a session
 */
export async function handleMergeCommand(
  platformKey: string,
  memoryKey: string,
  args: string[],
): Promise<CommandResult> {
  const sub = args[0]?.toLowerCase();

  if (!sub) {
    return {
      type: 'handled',
      message: [
        '📎 /merge — 会话关联管理',
        '',
        '用法：',
        '  /merge <session_id> [label]  — 关联一个 session 到当前会话',
        '  /merge list                  — 查看当前会话的关联列表',
        '  /merge remove <session_id>   — 取消关联',
        '',
        '关联后，agent 可通过工具按需读取关联会话的上下文。',
      ].join('\n'),
    };
  }

  if (sub === 'list' || sub === 'ls') {
    return handleMergeList(platformKey, memoryKey);
  }

  if (sub === 'remove' || sub === 'rm' || sub === 'unlink') {
    const targetSessionId = args[1]?.trim();
    if (!targetSessionId) {
      return {
        type: 'handled',
        message: '❌ 缺少 session-id\n用法：/merge remove <session-id>',
      };
    }
    return handleMergeRemove(platformKey, targetSessionId);
  }

  // Default: /merge <session_id> [label...]
  const targetSessionId = args[0].trim();
  const label = args.slice(1).join(' ').trim() || undefined;
  return handleMergeAdd(platformKey, memoryKey, targetSessionId, label);
}

async function handleMergeAdd(
  platformKey: string,
  memoryKey: string,
  targetSessionId: string,
  label?: string,
): Promise<CommandResult> {
  const result = await sessionStore.linkSession(platformKey, targetSessionId, label, memoryKey);

  if (!result.ok) {
    return {
      type: 'handled',
      message: `❌ 无法关联：${result.reason ?? '未知错误'}`,
    };
  }

  const labelInfo = label ? ` (label: "${label}")` : '';
  return {
    type: 'handled',
    message: `🔗 已关联 session${labelInfo}\n- Target: ${targetSessionId}\n- Agent 可通过 read_linked_session 工具按需读取关联上下文。`,
  };
}

async function handleMergeRemove(
  platformKey: string,
  targetSessionId: string,
): Promise<CommandResult> {
  const result = await sessionStore.unlinkSession(platformKey, targetSessionId);

  if (!result.ok) {
    return {
      type: 'handled',
      message: `❌ 无法取消关联：${result.reason ?? '未知错误'}`,
    };
  }

  return {
    type: 'handled',
    message: `🔗 已取消关联：${targetSessionId}`,
  };
}

async function handleMergeList(
  platformKey: string,
  memoryKey: string,
): Promise<CommandResult> {
  const { currentSessionId, links } = await sessionStore.getLinkedSessions(platformKey, memoryKey);

  if (!currentSessionId) {
    return {
      type: 'handled',
      message: 'ℹ️ 当前没有已绑定会话。发送普通消息会自动创建新会话。',
    };
  }

  if (links.length === 0) {
    return {
      type: 'handled',
      message: `📎 当前会话 ${currentSessionId} 没有关联的 session。\n用法：/merge <session-id> [label]`,
    };
  }

  const lines = links.map((link, index) => {
    const status = link.exists ? '✅' : '❌';
    const labelPart = link.label ? ` "${link.label}"` : '';
    const preview = link.preview.length > 60 ? `${link.preview.slice(0, 60)}...` : link.preview;
    return `${index + 1}. ${status} ${link.sessionId}${labelPart}\n   ${link.messageCount} 条消息 | 关联于 ${formatTime(link.linkedAt)}\n   ${preview}`;
  });

  return {
    type: 'handled',
    message: `📎 当前会话 ${currentSessionId} 的关联列表：\n${lines.join('\n')}`,
  };
}
