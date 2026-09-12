import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { FeishuStream } from '../../../src/plugins/main/channel/channels/feishu/feishu-stream';
import { FeishuRunActions } from '../../../src/plugins/main/channel/channels/feishu/run-actions';
import { MockFeishu } from './mock-client';

const output = fileURLToPath(new URL('../../../.harness/feishu-replay/trace.json', import.meta.url));
let sourceHash = '';
const traces: Array<{ name: string; note: string; frames: MockFeishu['frames']; calls: MockFeishu['calls'] }> = [];
const target = { requesterId: 'mock-user', chatId: 'mock-chat', isGroup: true, threadId: 'mock-topic', triggerMessageId: 'mock-trigger' };
const wait = (ms = 800) => vi.advanceTimersByTimeAsync(ms);

function finish(mock: MockFeishu, name: string, note = '') {
  expect(mock.violations).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
  for (const call of mock.calls.filter(call => call.operation === 'message.reply')) {
    expect(call.payload.path.message_id).toBe('mock-trigger');
    expect(call.payload.data.reply_in_thread).toBe(true);
  }
  traces.push({ name, note, frames: mock.frames, calls: mock.calls });
}

beforeAll(async () => {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(new URL('../../../.harness/feishu-replay/index.html', import.meta.url), '<meta charset="utf-8"><p>回放正在验证，完成后请运行 preview.mjs 生成预览。</p>');
  const hash = createHash('sha256');
  for (const file of ['feishu-stream.ts', 'run-card.ts', 'card.ts', 'feishu-client.ts', 'run-actions.ts']) {
    hash.update(file);
    hash.update(await readFile(new URL(`../../../src/plugins/main/channel/channels/feishu/${file}`, import.meta.url)));
  }
  sourceHash = hash.digest('hex');
  await writeFile(output, JSON.stringify({ status: 'running', scenarios: [] }));
});
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Replay must not access the network'); }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => {
  await writeFile(output, JSON.stringify({
    sourceHash,
    status: traces.length === 8 ? 'passed' : 'incomplete',
    boundary: 'Real FeishuStream and client helpers; simulated SDK responses and browser renderer. No account or network.',
    scenarios: traces,
  }, null, 2));
});

describe('offline Feishu event replay', () => {
  it('replays waiting, streamed input, tools, thinking, answer, and completion', async () => {
    const mock = new MockFeishu();
    const stream = new FeishuStream(mock.client, target);
    await stream.init(); stream.onRunStart(() => {}); await wait(2400);
    stream.onText('我先检查仓库入口和当前工作区。'); await wait();
    stream.onToolInputStart({ id: 'tool-1', toolName: 'bash' });
    stream.onToolInputDelta({ id: 'tool-1', delta: '{"command":"git sta' }); await wait();
    expect(JSON.stringify(mock.card)).toContain('git sta');
    stream.onToolInputDelta({ id: 'tool-1', delta: 'tus --short"}' }); await wait();
    stream.onToolInputEnd({ id: 'tool-1' });
    stream.onToolCall('bash', { command: 'git status --short' }, 'tool-1'); await wait(1600);
    stream.onToolResult({ name: 'bash', result: 'clean', toolCallId: 'tool-1' }); await wait();
    expect(JSON.stringify(mock.card)).toContain('Thinking');
    stream.onText('仓库状态已确认，正在整理目录说明。\n\n'); await wait();
    for (const delta of ['仓库', '读取完成。\n\n', '**结论**：', '工作区干净，', '可以开始下一步。']) {
      stream.onText(delta); await wait();
    }
    await stream.onDone('仓库读取完成。\n\n**结论**：工作区干净，可以开始下一步。');
    expect(mock.card?.config?.streaming_mode).not.toBe(true);
    expect(JSON.stringify(mock.card)).toContain('Completed');
    expect(JSON.stringify(mock.card)).toContain('我先检查仓库入口');
    expect(JSON.stringify(mock.card)).not.toContain('可以开始下一步');
    expect(JSON.stringify(mock.replyCard)).toContain('可以开始下一步');
    const count = mock.calls.length; await wait(6000); expect(mock.calls).toHaveLength(count);
    expect(mock.calls.filter(c => c.operation === 'message.reply')).toHaveLength(2);
    finish(mock, '完整流程');
  });

  it('renders an error and closes streaming', async () => {
    const mock = new MockFeishu(); const stream = new FeishuStream(mock.client, target);
    await stream.init(); stream.onRunStart(() => {}); stream.onText('正在读取仓库'); await wait();
    await stream.onError('读取失败，请检查工作区路径。');
    expect(mock.card?.config?.streaming_mode).not.toBe(true);
    expect(JSON.stringify(mock.replyCard)).toContain('读取失败');
    const count = mock.calls.length; await wait(6000); expect(mock.calls).toHaveLength(count);
    finish(mock, '执行报错');
  });

  it('falls back to legacy cards without CardKit permission', async () => {
    const mock = new MockFeishu(); mock.denyCardkit = true;
    const stream = new FeishuStream(mock.client, target);
    await stream.init(); stream.onRunStart(() => {}); stream.onText('兼容模式仍然有结果'); await wait();
    await stream.onDone('兼容模式仍然有结果');
    expect(mock.calls.some(c => c.operation === 'message.patch')).toBe(true);
    expect(mock.calls.some(c => c.operation === 'element.content')).toBe(false);
    finish(mock, '权限不足', '整卡更新降级，不提供原生打字机动画。');
  });

  it('recovers from a rejected content update without losing accumulated text', async () => {
    const mock = new MockFeishu(); const stream = new FeishuStream(mock.client, target);
    await stream.init(); stream.onRunStart(() => {}); mock.rejectNextContent = true;
    stream.onText('第一段'); await wait(); stream.onText('，第二段'); await wait();
    expect(JSON.stringify(mock.card)).toContain('第一段，第二段');
    await stream.onDone('第一段，第二段');
    const updates = mock.calls.filter(c => c.operation === 'element.content');
    expect(updates.length).toBeGreaterThanOrEqual(2);
    finish(mock, '短暂拒绝后恢复');
  });

  it('coalesces slow updates and delivers completion after the active request', async () => {
    const mock = new MockFeishu(); const stream = new FeishuStream(mock.client, target);
    await stream.init(); stream.onRunStart(() => {}); mock.contentDelay = 2400;
    stream.onText('第一段'); await wait(); stream.onText('第二段'); await wait(); stream.onText('第三段');
    const done = stream.onDone('最终结果'); await wait(5500); await done;
    expect(JSON.stringify(mock.replyCard)).toContain('最终结果');
    expect(mock.calls.filter(c => c.operation === 'element.content')).toHaveLength(2);
    const count = mock.calls.length; await wait(6000); expect(mock.calls).toHaveLength(count);
    finish(mock, '慢请求与收尾');
  });

  it('supersedes a late native request and closes the final card', async () => {
    const mock = new MockFeishu(); const stream = new FeishuStream(mock.client, target);
    await stream.init(); stream.onRunStart(() => {}); mock.contentDelay = 15000;
    stream.onToolCall('read', { path: '/demo/README.md' }, 'tool-1'); stream.onText('旧进度'); await wait();
    const done = stream.onDone('最终结果'); await wait(10000); await done; await wait(6000);
    expect(mock.frames.filter(frame => frame.text)).toHaveLength(0);
    expect(JSON.stringify(mock.replyCard)).toContain('最终结果');
    expect(mock.card?.config?.streaming_mode).not.toBe(true);
    expect(mock.calls.filter(c => c.operation === 'element.content')).toHaveLength(1);
    finish(mock, '请求超时后迟到', '原生 CardKit 使用递增序号收尾，迟到的旧请求不能覆盖最终卡片。');
  });

  it('keeps long Chinese markdown, code, and tool details inspectable', async () => {
    const mock = new MockFeishu(); const stream = new FeishuStream(mock.client, target);
    await stream.init(); stream.onRunStart(() => {});
    stream.onToolCall('read', { path: '/demo/非常长的中文文件名称用于检查窄屏换行和溢出情况.md' }, 'tool-1'); await wait();
    const text = '## 检查结果\n\n' + '这是用于检查窄屏显示的说明文字。'.repeat(30) +
      '\n\n```ts\nconst example = "' + 'long_unbroken_value_'.repeat(12) + '";\n```\n\n- 中文条目\n- English item';
    stream.onText(text); await wait(); stream.onToolResult({ name: 'read', result: 'ok', toolCallId: 'tool-1' });
    await stream.onDone(text);
    expect(JSON.stringify(mock.replyCard)).toContain('English item');
    finish(mock, '长文本与窄屏');
  });
  it('stops only the active originating user turn and removes its button on completion', async () => {
    const mock = new MockFeishu(); const actions = new FeishuRunActions();
    const stop = vi.fn(); const stream = new FeishuStream(mock.client, target, actions);
    await stream.init(); stream.onRunStart(stop); await wait();
    stream.onText('正在检查仓库结构。'); await wait();
    const button = mock.replyCard!.body.elements.find((item: any) => item.tag === 'button');
    const event = { context: { open_message_id: 'mock-reply' }, operator: { open_id: 'mock-user' }, action: { value: button.value } };
    actions.handle({ ...event, operator: { open_id: 'another-user' } }); expect(stop).not.toHaveBeenCalled();
    actions.handle(event); expect(stop).toHaveBeenCalledOnce(); await wait();
    expect(JSON.stringify(mock.replyCard)).toContain('正在停止');
    await stream.onDone('正在检查仓库结构。', { stopped: true });
    expect(JSON.stringify(mock.card)).toContain('正在检查仓库结构。');
    expect(JSON.stringify(mock.card)).toContain('Stopped');
    expect(JSON.stringify(mock.replyCard)).toContain('已停止');
    expect(mock.replyCard!.body.elements.some((item: any) => item.tag === 'button')).toBe(false);
    actions.handle(event); expect(stop).toHaveBeenCalledOnce();
    finish(mock, '停止任务', '按钮绑定发起人和当前回复；旧按钮不能停止后续任务。');
  });

});
