/**
 * Context handover for externally-driven roles. The coding-agent CLI shares
 * no history with the built-in engine, so each segment sends a rendered
 * window of the labeled discussion. With a resumed CLI session the agent
 * additionally remembers its own past work; the window is sent regardless
 * (overlap is cheaper than a gap, and stale sessions degrade safely).
 */

import type { AgentRoleDefinition } from '../../../shared/agent-roles';
import type { CanvasAgentMessage } from '../types';

export const EXTERNAL_PROMPT_HISTORY_WINDOW = 12;
const MESSAGE_CHAR_CAP = 2000;

const speakerOf = (message: CanvasAgentMessage): string => {
  if (message.role === 'user') return '用户';
  return message.speakerRoleName ? `【${message.speakerRoleName}】` : '「助手」';
};

export function renderExternalSegmentPrompt(opts: {
  role: AgentRoleDefinition;
  cwd: string;
  history: CanvasAgentMessage[];
  currentAsk: string;
  /** Names this role may @-mention to hand the floor on (empty → omit the rule). */
  handoffNames: string[];
  resumed: boolean;
}): string {
  const { role, cwd, history, currentAsk, handoffNames, resumed } = opts;
  const window = history
    .filter(message => message.content.trim())
    .slice(-EXTERNAL_PROMPT_HISTORY_WINDOW)
    .map(message => `${speakerOf(message)}: ${message.content.slice(0, MESSAGE_CHAR_CAP)}`);

  const otherNames = handoffNames.filter(name => name && name !== role.name);

  const persona = role.prompt.trim();
  return [
    `你是群聊「AI Chat」中的角色「${role.name}」,由本地编码 Agent 驱动,工作目录是 ${cwd}(可以读写其中的代码来完成请求)。`,
    // Optional for external roles: without one, the agent keeps its own
    // instructions (CLAUDE.md / AGENTS.md) as its only persona.
    ...(persona ? ['', '<role_persona>', persona, '</role_persona>'] : []),
    '',
    '群聊协议:',
    '- 历史里 【名字】: 开头的是其他角色的发言,「助手」: 是默认助手,用户: 是用户本人。',
    `- 以「${role.name}」的身份直接输出回复正文;不要自己加 【】 前缀,署名由系统处理。`,
    '- 只代表你自己发言,不替其他角色说话。',
    ...(otherNames.length > 0
      ? [`- 确有必要让其他角色接话时,在正文中写 @名字(可选:${otherNames.map(name => `@${name}`).join('、')});不要客套性点名。`]
      : []),
    '',
    resumed
      ? '## 近期讨论(自动附带,可能与你会话里已知的内容有重叠)'
      : '## 近期讨论',
    ...(window.length > 0 ? window : ['(这是本群聊的第一条消息)']),
    '',
    '## 本轮请求',
    currentAsk,
  ].join('\n');
}
