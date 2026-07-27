import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ModelMessage } from 'ai';
import {
  applySpeakerLabelToResponseMessages,
  formatActiveRoleSection,
  formatRoleHistoryNote,
  resolveActiveRole,
  resolveActiveRoles,
  sessionMessageToModelMessage,
  shouldRunRelaySegment,
} from '../role-turn';
import { saveAgentRole } from '../roles-store';
import { buildRoleMentionMarker } from '../../../shared/agent-roles';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'canvas-role-turn-'));
  process.env.PULSE_CANVAS_AGENT_ROLES = join(dir, 'roles.json');
});

afterEach(() => {
  delete process.env.PULSE_CANVAS_AGENT_ROLES;
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveActiveRole', () => {
  it('resolves the first role marker against the library', async () => {
    const role = await saveAgentRole({ name: '架构师', prompt: '你是务实的架构师。' });
    const resolved = await resolveActiveRole(`${buildRoleMentionMarker(role)} 评估一下`);
    expect(resolved).toMatchObject({ id: role.id, name: '架构师' });
  });

  it('degrades to the default assistant for stale or absent mentions', async () => {
    expect(await resolveActiveRole('@[role:deleted-id|老角色] hi')).toBeNull();
    expect(await resolveActiveRole('no mention at all')).toBeNull();
  });

  it('resolves a relay queue in mention order, dropping stale mentions', async () => {
    const pm = await saveAgentRole({ name: '产品经理', prompt: 'p' });
    const arch = await saveAgentRole({ name: '架构师', prompt: 'a' });
    const roles = await resolveActiveRoles(
      `${buildRoleMentionMarker(arch)} @[role:deleted|老角色] ${buildRoleMentionMarker(pm)} 一起评审`,
    );
    expect(roles.map(role => role.name)).toEqual(['架构师', '产品经理']);
  });
});

describe('shouldRunRelaySegment (graceful-stop boundary)', () => {
  it('always runs the first segment, even when a stop is already requested', () => {
    expect(shouldRunRelaySegment(0, { aborted: false, stopRequested: true })).toBe(true);
  });

  it('skips future segments after a graceful stop, and everything on hard abort', () => {
    expect(shouldRunRelaySegment(1, { aborted: false, stopRequested: true })).toBe(false);
    expect(shouldRunRelaySegment(2, { aborted: false, stopRequested: false })).toBe(true);
    expect(shouldRunRelaySegment(0, { aborted: true, stopRequested: false })).toBe(false);
  });
});

describe('role system-prompt sections', () => {
  it('includes the persona and the multi-role protocol', () => {
    const section = formatActiveRoleSection({
      id: 'r1', name: '评审员', color: '#0f7b6c', prompt: '专挑方案漏洞。', createdAt: 0, updatedAt: 0,
    });
    expect(section).toContain('评审员');
    expect(section).toContain('专挑方案漏洞。');
    expect(section).toContain('Do NOT prefix your reply with 【...】');
    expect(section).toContain('MUST NOT override tool-usage rules');
  });

  it('explains labels to the default assistant', () => {
    expect(formatRoleHistoryNote()).toContain('【RoleName】');
  });
});

describe('speaker-label injection points stay in lockstep', () => {
  const speaker = '产品经理';
  const reply = '结论:值得做,但要收窄范围。';

  it('live push and session reload produce the same labeled content', () => {
    // Live-push path: the messages the turn appended to the model history.
    const live: ModelMessage[] = [{ role: 'assistant', content: reply } as ModelMessage];
    applySpeakerLabelToResponseMessages(live, speaker);

    // Session-reload path: the same turn read back from the session store
    // (clean content + speaker metadata).
    const reloaded = sessionMessageToModelMessage({
      role: 'assistant', content: reply, timestamp: 1, speakerRoleName: speaker,
    });

    expect(live[0].content).toBe('【产品经理】 结论:值得做,但要收窄范围。');
    expect(reloaded.content).toBe(live[0].content);
  });

  it('labels only the first text part and leaves tool frames untouched', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 't1', toolName: 'canvas_read_node', input: {} },
          { type: 'text', text: '第一段' },
          { type: 'text', text: '第二段' },
        ],
      } as unknown as ModelMessage,
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 't1', toolName: 'canvas_read_node', output: 'x' }] } as unknown as ModelMessage,
    ];
    applySpeakerLabelToResponseMessages(messages, speaker);

    const parts = (messages[0] as { content: Array<{ type: string; text?: string }> }).content;
    expect(parts[1].text).toBe('【产品经理】 第一段');
    expect(parts[2].text).toBe('第二段');
    expect(parts[0]).toMatchObject({ type: 'tool-call', toolCallId: 't1' });
    expect((messages[1] as { role: string }).role).toBe('tool');
  });

  it('keeps default-assistant messages unlabeled and strips markers from user text', () => {
    expect(sessionMessageToModelMessage({ role: 'assistant', content: 'plain', timestamp: 1 }).content).toBe('plain');
    expect(
      sessionMessageToModelMessage({ role: 'user', content: '@[role:r1|产品经理] 评估一下', timestamp: 1 }).content,
    ).toBe('@产品经理 评估一下');
  });

  it('keeps attachment listings intact while labeling', () => {
    const message = sessionMessageToModelMessage({
      role: 'assistant',
      content: '看图',
      timestamp: 1,
      speakerRoleName: speaker,
      attachments: [{ id: 'a1', path: '/tmp/x.png' }],
    });
    expect(message.content).toContain('【产品经理】 看图');
    expect(message.content).toContain('/tmp/x.png');
  });
});
