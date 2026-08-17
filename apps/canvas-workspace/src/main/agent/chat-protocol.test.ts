import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveChatRegistry } from './active-chat-registry';
import {
  prepareChatTurn,
  submitChatRunInput,
  validatePreparedChatPayload,
} from './chat-protocol';
import { PreparedChatRegistry } from './prepared-chat';

const dirs: string[] = [];
const sender = { id: 1 } as WebContents;

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('chat protocol', () => {
  it('delivers steer and follow-up input only to the matching active run', async () => {
    const activeChats = new ActiveChatRegistry();
    const scope = { kind: 'global' } as const;
    expect(activeChats.register('run-active', scope)).not.toBeNull();
    const submitRunInput = vi.fn(async () => ({ ok: true as const }));
    const service = { submitRunInput };

    await expect(submitChatRunInput({
      sessionId: 'run-active',
      text: 'change direction',
      mode: 'steer',
      activeChats,
      service: service as never,
    })).resolves.toEqual({ ok: true });
    expect(submitRunInput).toHaveBeenCalledWith('run-active', scope, 'steer', 'change direction');

    await expect(submitChatRunInput({
      sessionId: 'run-missing',
      text: 'later',
      mode: 'follow-up',
      activeChats,
      service: service as never,
    })).resolves.toMatchObject({ ok: false, code: 'CHAT_RUN_NOT_ACTIVE' });
    expect(submitRunInput).toHaveBeenCalledTimes(1);

    await expect(submitChatRunInput({
      sessionId: 'run-active',
      text: 'invalid mode',
      mode: 'later' as never,
      activeChats,
      service: service as never,
    })).resolves.toMatchObject({ ok: false, code: 'CHAT_INPUT_MODE_INVALID' });
    expect(submitRunInput).toHaveBeenCalledTimes(1);
  });

  it('rejects attachment count and real on-disk total before reserving a run', async () => {
    const tooMany = Array.from({ length: 7 }, (_, index) => ({
      id: `a-${index}`,
      path: `/missing-${index}`,
    }));
    await expect(validatePreparedChatPayload({
      message: '',
      attachments: tooMany,
    })).resolves.toMatchObject({ code: 'ATTACHMENT_LIMIT' });

    const dir = await mkdtemp(join(tmpdir(), 'chat-protocol-'));
    dirs.push(dir);
    const paths = await Promise.all([0, 1, 2].map(async (index) => {
      const path = join(dir, `${index}.png`);
      await writeFile(path, Buffer.alloc(11 * 1024 * 1024));
      return path;
    }));
    await expect(validatePreparedChatPayload({
      message: '',
      attachments: paths.map((path, index) => ({ id: `a-${index}`, path })),
    })).resolves.toMatchObject({ code: 'ATTACHMENT_LIMIT' });
  });

  it('reserves the scope at prepare time and releases it when discarded', async () => {
    const activeChats = new ActiveChatRegistry();
    const preparedChats = new PreparedChatRegistry();
    const scope = { kind: 'global' } as const;
    const first = await prepareChatTurn({
      sender,
      scope,
      payload: {
        message: 'first',
        requestContext: { expectedConversationSessionId: 'conversation-a' },
      },
      activeChats,
      preparedChats,
    });
    const blocked = await prepareChatTurn({
      sender,
      scope,
      payload: {
        message: 'second',
        requestContext: { expectedConversationSessionId: 'conversation-a' },
      },
      activeChats,
      preparedChats,
    });

    expect(first.ok).toBe(true);
    expect(activeChats.hasScope(scope)).toBe(true);
    expect(blocked).toMatchObject({ ok: false, code: 'CHAT_SCOPE_BUSY' });
    if (first.ok) preparedChats.discard(first.sessionId);
    expect(activeChats.hasScope(scope)).toBe(false);
  });
});
