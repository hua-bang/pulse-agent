import type { ChatRunInputMode } from '../../shared/agent-chat';
import { resolveAgentRuntime } from './backends';

export async function deliverRunInput(
  runId: string,
  mode: ChatRunInputMode,
  text: string,
): Promise<{ ok: boolean; code?: string; error?: string }> {
  const runtime = resolveAgentRuntime(null);
  const submit = mode === 'steer' ? runtime.steer : runtime.followUp;
  if (!submit) {
    return { ok: false, code: 'CHAT_INPUT_UNSUPPORTED', error: 'This chat runtime does not accept input while running.' };
  }
  const accepted = await submit.call(runtime, runId, text);
  return accepted
    ? { ok: true }
    : { ok: false, code: 'CHAT_INPUT_NOT_READY', error: 'The active runtime is not ready for more input.' };
}
