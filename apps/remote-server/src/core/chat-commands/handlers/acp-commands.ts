import { promises as fs } from 'fs';
import { resolve as resolvePath } from 'path';
import {
  buildAcpEnableState,
  clearAcpState,
  closeAcpSession,
  getAcpState,
  listAcpSessions,
  setAcpState,
  updateAcpCwd,
} from 'pulse-coder-acp';
import type { AcpAgent } from 'pulse-coder-acp';
import type { CommandResult } from '../types.js';

const VALID_AGENTS: AcpAgent[] = ['claude', 'codex'];

const ACP_CLIENT_INFO = {
  name: 'pulse-remote-server',
  title: 'Pulse Remote Server',
  version: '1.0.0',
};

function isValidAgent(s: string): s is AcpAgent {
  return (VALID_AGENTS as string[]).includes(s);
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function handleAcpCommand(platformKey: string, args: string[]): Promise<CommandResult> {
  const sub = args[0]?.toLowerCase();

  // /acp  or  /acp status
  if (!sub || sub === 'status') {
    const state = await getAcpState(platformKey);
    if (!state) {
      return {
        type: 'handled',
        message: 'ℹ️ ACP 未启用。\n使用 `/acp on <claude|codex> [cwd]` 开启。',
      };
    }
    const lines = [
      '🤖 ACP 已启用',
      `- agent: ${state.agent}`,
      `- cwd: ${state.cwd}`,
      state.sessionId ? `- session: ${state.sessionId}` : '- session: (新会话)',
    ];
    return { type: 'handled', message: lines.join('\n') };
  }

  // /acp on <claude|codex> [cwd]
  if (sub === 'on') {
    const agentRaw = args[1]?.toLowerCase();
    if (!agentRaw || !isValidAgent(agentRaw)) {
      return {
        type: 'handled',
        message: '❌ 用法：`/acp on <claude|codex> [cwd]`',
      };
    }

    let cwd = args[2]?.trim();
    if (cwd) {
      cwd = resolvePath(cwd);
      if (!(await dirExists(cwd))) {
        return {
          type: 'handled',
          message: `❌ 目录不存在：${cwd}`,
        };
      }
    } else {
      // reuse existing cwd if already configured, else use process.cwd()
      const existing = await getAcpState(platformKey);
      cwd = existing?.cwd ?? process.cwd();
    }

    const existing = await getAcpState(platformKey);
    const nextState = buildAcpEnableState(existing, agentRaw, cwd);
    await setAcpState(platformKey, nextState);
    const sessionLine = nextState.sessionId
      ? `\n- session: ${nextState.sessionId} (preserved)`
      : '\n- session: (新会话)';
    return {
      type: 'handled',
      message: `✅ ACP 已开启\n- agent: ${agentRaw}\n- cwd: ${cwd}${sessionLine}\n下次发消息将由 ${agentRaw} 处理。`,
    };
  }

  // /acp off
  if (sub === 'off') {
    const existing = await getAcpState(platformKey);
    if (!existing) {
      return { type: 'handled', message: 'ℹ️ ACP 本来就是关闭状态。' };
    }

    const closeLine = await tryCloseAcpSession(platformKey, existing);
    await clearAcpState(platformKey);
    return {
      type: 'handled',
      message: ['✅ ACP 已关闭，恢复使用 pulse-agent。', closeLine].filter(Boolean).join('\n'),
    };
  }

  if (sub === 'sessions') {
    const state = await getAcpState(platformKey);
    if (!state) {
      return { type: 'handled', message: '❌ ACP 未启用，请先 `/acp on <claude|codex>`。' };
    }

    try {
      const result = await listAcpSessions({
        platformKey,
        agent: state.agent,
        cwd: state.cwd,
        sessionId: state.sessionId,
        clientInfo: ACP_CLIENT_INFO,
      });
      if (result.sessions.length === 0) {
        return { type: 'handled', message: 'ℹ️ 当前 ACP agent 未返回已有 session。' };
      }
      const lines = result.sessions.slice(0, 20).map((session) => {
        const marker = session.sessionId === state.sessionId ? ' *' : '';
        const title = session.title ? ` — ${session.title}` : '';
        const updated = session.updatedAt ? ` (${session.updatedAt})` : '';
        return `- ${session.sessionId}${marker}\n  cwd: ${session.cwd}${title}${updated}`;
      });
      const more = result.nextCursor ? '\n… 还有更多 session（当前命令暂未翻页）。' : '';
      return { type: 'handled', message: `📚 ACP sessions\n${lines.join('\n')}${more}` };
    } catch (err) {
      return {
        type: 'handled',
        message: `❌ 当前 ACP agent 不支持或无法执行 session/list：${formatError(err)}`,
      };
    }
  }

  // /acp cd <path>
  if (sub === 'cd') {
    const rawPath = args[1]?.trim();
    if (!rawPath) {
      return { type: 'handled', message: '❌ 用法：`/acp cd <path>`' };
    }

    const newCwd = resolvePath(rawPath);
    if (!(await dirExists(newCwd))) {
      return { type: 'handled', message: `❌ 目录不存在：${newCwd}` };
    }

    const updated = await updateAcpCwd(platformKey, newCwd);
    if (!updated) {
      return { type: 'handled', message: '❌ ACP 未启用，请先 `/acp on <claude|codex>`。' };
    }

    return {
      type: 'handled',
      message: `✅ ACP 工作目录已切换\n- cwd: ${newCwd}\n旧 session 已重置，下次发消息将开启新会话。`,
    };
  }

  return {
    type: 'handled',
    message: [
      '⚠️ 未知子命令。ACP 用法：',
      '`/acp on <claude|codex> [cwd]` — 开启 ACP 模式',
      '`/acp off`                     — 关闭，恢复 pulse-agent（支持时关闭 ACP session）',
      '`/acp cd <path>`               — 切换工作目录（重置 session）',
      '`/acp sessions`                — 列出 agent 已知 session（若支持）',
      '`/acp status`                  — 查看当前状态',
    ].join('\n'),
  };
}

async function tryCloseAcpSession(platformKey: string, state: { agent: AcpAgent; cwd: string; sessionId?: string }): Promise<string | null> {
  if (!state.sessionId) return null;
  try {
    const closed = await closeAcpSession({
      platformKey,
      agent: state.agent,
      cwd: state.cwd,
      sessionId: state.sessionId,
      clientInfo: ACP_CLIENT_INFO,
    });
    return closed ? '- ACP session 已通过 session/close 关闭。' : '- ACP agent 未声明 session/close，已仅清除本地状态。';
  } catch (err) {
    return `- session/close 执行失败，已仅清除本地状态：${formatError(err)}`;
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
