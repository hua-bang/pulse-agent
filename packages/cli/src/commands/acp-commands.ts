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

const DEFAULT_ACP_USER = 'local';
const VALID_AGENTS: AcpAgent[] = ['claude', 'codex'];

export const ACP_CLIENT_INFO = {
  name: 'pulse-cli',
  title: 'Pulse CLI',
  version: '1.0.0',
};

export function resolveAcpPlatformKey(): string {
  const explicit = process.env.PULSE_CODER_ACP_PLATFORM_KEY?.trim();
  if (explicit) {
    return explicit;
  }

  const memoryKey = process.env.PULSE_CODER_MEMORY_PLATFORM_KEY?.trim();
  if (memoryKey) {
    return memoryKey;
  }

  const user = process.env.PULSE_CODER_ACP_USER?.trim()
    || process.env.USER?.trim()
    || process.env.LOGNAME?.trim()
    || DEFAULT_ACP_USER;
  return `cli:${user}`;
}

export async function handleAcpCommand(platformKey: string, args: string[]): Promise<string> {
  const sub = args[0]?.toLowerCase();

  if (!sub || sub === 'status') {
    const state = await getAcpState(platformKey);
    if (!state) {
      return 'ℹ️ ACP 未启用。\n使用 `/acp on <claude|codex> [cwd]` 开启。';
    }
    const lines = [
      '🤖 ACP 已启用',
      `- agent: ${state.agent}`,
      `- cwd: ${state.cwd}`,
      state.sessionId ? `- session: ${state.sessionId}` : '- session: (新会话)',
    ];
    return lines.join('\n');
  }

  if (sub === 'on') {
    const agentRaw = args[1]?.toLowerCase();
    if (!agentRaw || !isValidAgent(agentRaw)) {
      return '❌ 用法：`/acp on <claude|codex> [cwd]`';
    }

    let cwd = args[2]?.trim();
    if (cwd) {
      cwd = resolvePath(cwd);
      if (!(await dirExists(cwd))) {
        return `❌ 目录不存在：${cwd}`;
      }
    } else {
      const existing = await getAcpState(platformKey);
      cwd = existing?.cwd ?? process.cwd();
    }

    const existing = await getAcpState(platformKey);
    const nextState = buildAcpEnableState(existing, agentRaw, cwd);
    await setAcpState(platformKey, nextState);
    const sessionLine = nextState.sessionId
      ? `\n- session: ${nextState.sessionId} (preserved)`
      : '\n- session: (新会话)';
    return `✅ ACP 已开启\n- agent: ${agentRaw}\n- cwd: ${cwd}${sessionLine}\n下次发消息将由 ${agentRaw} 处理。`;
  }

  if (sub === 'off') {
    const existing = await getAcpState(platformKey);
    if (!existing) {
      return 'ℹ️ ACP 本来就是关闭状态。';
    }

    const closeLine = await tryCloseAcpSession(platformKey, existing);
    await clearAcpState(platformKey);
    return ['✅ ACP 已关闭，恢复使用 pulse-agent。', closeLine].filter(Boolean).join('\n');
  }

  if (sub === 'sessions') {
    const state = await getAcpState(platformKey);
    if (!state) {
      return '❌ ACP 未启用，请先 `/acp on <claude|codex>`。';
    }

    try {
      const result = await listAcpSessions({
        platformKey,
        agent: state.agent,
        cwd: state.cwd,
        sessionId: state.sessionId,
        clientInfo: ACP_CLIENT_INFO,
      });
      if (result.sessions.length === 0) return 'ℹ️ 当前 ACP agent 未返回已有 session。';
      const lines = result.sessions.slice(0, 20).map((session) => {
        const marker = session.sessionId === state.sessionId ? ' *' : '';
        const title = session.title ? ` — ${session.title}` : '';
        const updated = session.updatedAt ? ` (${session.updatedAt})` : '';
        return `- ${session.sessionId}${marker}\n  cwd: ${session.cwd}${title}${updated}`;
      });
      const more = result.nextCursor ? '\n… 还有更多 session（当前命令暂未翻页）。' : '';
      return `📚 ACP sessions\n${lines.join('\n')}${more}`;
    } catch (err) {
      return `❌ 当前 ACP agent 不支持或无法执行 session/list：${formatError(err)}`;
    }
  }

  if (sub === 'cd') {
    const rawPath = args[1]?.trim();
    if (!rawPath) {
      return '❌ 用法：`/acp cd <path>`';
    }

    const newCwd = resolvePath(rawPath);
    if (!(await dirExists(newCwd))) {
      return `❌ 目录不存在：${newCwd}`;
    }

    const updated = await updateAcpCwd(platformKey, newCwd);
    if (!updated) {
      return '❌ ACP 未启用，请先 `/acp on <claude|codex>`。';
    }

    return `✅ ACP 工作目录已切换\n- cwd: ${newCwd}\n旧 session 已重置，下次发消息将开启新会话。`;
  }

  return [
    '⚠️ 未知子命令。ACP 用法：',
    '`/acp on <claude|codex> [cwd]` — 开启 ACP 模式',
    '`/acp off`                     — 关闭，恢复 pulse-agent（支持时关闭 ACP session）',
    '`/acp cd <path>`               — 切换工作目录（重置 session）',
    '`/acp sessions`                — 列出 agent 已知 session（若支持）',
    '`/acp status`                  — 查看当前状态',
  ].join('\n');
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function isValidAgent(value: string): value is AcpAgent {
  return (VALID_AGENTS as string[]).includes(value);
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
