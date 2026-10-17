import { engine } from '../../engine-singleton.js';
import type { CommandResult } from '../types.js';

/** `platformKey` scopes the mode to one conversation (see agent-runner planModeScope). */
export function handleModeCommand(args: string[], platformKey: string): CommandResult {
  const sub = args[0]?.toLowerCase();
  const mode = engine.getMode(platformKey);

  if (!mode) {
    return {
      type: 'handled',
      message: '⚠️ 当前引擎未启用 plan mode 服务。',
    };
  }

  if (!sub || sub === 'status') {
    return {
      type: 'handled',
      message: `🧭 当前模式：${mode}`,
    };
  }

  if (sub !== 'planning' && sub !== 'executing') {
    return {
      type: 'handled',
      message: '❌ 用法：/mode [status|planning|executing]',
    };
  }

  const changed = engine.setMode(sub, 'command', platformKey);
  return {
    type: 'handled',
    message: changed ? `✅ 已切换为 ${sub} 模式` : '⚠️ 无法切换模式（plan mode 服务不可用）',
  };
}
