// @vitest-environment happy-dom
import { act, useState, type Dispatch, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import type { ChatImageAttachment } from '../types';
import { resetChatAttachmentRuntimesForTests } from './chatAttachmentRuntime';
import { useChatAttachments } from './useChatAttachments';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;
let latest: ReturnType<typeof useChatAttachments> | null = null;

afterEach(() => {
  resetChatAttachmentRuntimesForTests();
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  vi.restoreAllMocks();
});

const mount = async (
  saveImage: ReturnType<typeof vi.fn>,
  initialAttachments: ChatImageAttachment[] = [],
  deleteSavedImage = vi.fn(async () => ({ ok: true })),
) => {
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: { file: { saveImage, deleteSavedImage } },
  });
  const Probe = () => {
    const [attachments, setAttachments] = useState<ChatImageAttachment[]>(initialAttachments);
    latest = useChatAttachments({
      scopeId: 'workspace-a',
      attachments,
      setAttachments,
    });
    return null;
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  ));
};

const imageFile = (name: string, sizeBytes?: number): File => {
  const file = new File(['image'], name, { type: 'image/png' });
  if (sizeBytes !== undefined) {
    Object.defineProperty(file, 'size', { configurable: true, value: sizeBytes });
  }
  return file;
};

const waitForAttachmentStatus = async (status: ChatImageAttachment['status']) => {
  for (let attempt = 0; attempt < 20 && latest?.attachments[0]?.status !== status; attempt += 1) {
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });
  }
  expect(latest?.attachments[0]?.status).toBe(status);
};

describe('useChatAttachments', () => {
  it('shows selected images immediately in original order, then marks them ready', async () => {
    let finishFirst: ((value: { ok: boolean; filePath: string }) => void) | undefined;
    let finishSecond: ((value: { ok: boolean; filePath: string }) => void) | undefined;
    const saveImage = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
    await mount(saveImage);

    act(() => {
      latest?.handleAttachFiles([
        new File(['first'], 'first.png', { type: 'image/png' }),
        new File(['second'], 'second.png', { type: 'image/png' }),
      ]);
    });
    expect(latest?.attachments.map(item => [item.fileName, item.status])).toEqual([
      ['first.png', 'uploading'],
      ['second.png', 'uploading'],
    ]);

    await act(async () => {
      await vi.waitFor(() => expect(saveImage).toHaveBeenCalledTimes(1));
    });
    await act(async () => {
      finishFirst?.({ ok: true, filePath: '/tmp/first.png' });
      await Promise.resolve();
    });
    await act(async () => {
      await vi.waitFor(() => expect(saveImage).toHaveBeenCalledTimes(2));
      finishSecond?.({ ok: true, filePath: '/tmp/second.png' });
      await Promise.resolve();
    });
    expect(latest?.attachments.map(item => [item.fileName, item.status, item.path])).toEqual([
      ['first.png', 'ready', '/tmp/first.png'],
      ['second.png', 'ready', '/tmp/second.png'],
    ]);
  });

  it('keeps a failed attachment visible and lets the user retry it', async () => {
    const saveImage = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'disk full' })
      .mockResolvedValueOnce({ ok: true, filePath: '/tmp/retried.png' });
    await mount(saveImage);

    act(() => {
      latest?.handleAttachFiles([
        new File(['image'], 'retry.png', { type: 'image/png' }),
      ]);
    });
    await waitForAttachmentStatus('failed');
    expect(latest?.attachments[0]?.error).toBe('disk full');
    expect(latest?.sendBlocked).toBe(true);

    await act(async () => {
      latest?.retryAttachment(latest.attachments[0].id);
      await Promise.resolve();
    });
    await waitForAttachmentStatus('ready');
    expect(latest?.sendBlocked).toBe(false);
  });

  it('rejects oversized images before reading or saving them', async () => {
    const saveImage = vi.fn();
    await mount(saveImage);

    act(() => {
      latest?.handleAttachFiles([
        new File(
          [new Uint8Array(12 * 1024 * 1024 + 1)],
          'oversized.png',
          { type: 'image/png' },
        ),
      ]);
    });

    expect(latest?.attachments[0]).toMatchObject({
      fileName: 'oversized.png',
      status: 'failed',
      retryable: false,
    });
    expect(saveImage).not.toHaveBeenCalled();
  });

  it('cancels queued work before it can save after removal', async () => {
    let finishFirst: ((value: { ok: boolean; filePath: string }) => void) | undefined;
    const saveImage = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockResolvedValue({ ok: true, filePath: '/tmp/should-not-exist.png' });
    await mount(saveImage);

    act(() => {
      latest?.handleAttachFiles([
        imageFile('first.png'),
        imageFile('remove-before-save.png'),
      ]);
    });
    await act(async () => {
      await vi.waitFor(() => expect(saveImage).toHaveBeenCalledTimes(1));
    });
    const queuedId = latest?.attachments[1]?.id;
    expect(queuedId).toBeTruthy();
    act(() => latest?.removeAttachment(queuedId!));
    await act(async () => {
      finishFirst?.({ ok: true, filePath: '/tmp/first.png' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveImage).toHaveBeenCalledTimes(1);
    expect(latest?.attachments.map(item => item.fileName)).toEqual(['first.png']);
  });

  it('does not revive an attachment removed while saveImage is in flight', async () => {
    let finishSave: ((value: { ok: boolean; filePath: string }) => void) | undefined;
    const saveImage = vi.fn()
      .mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
    const deleteSavedImage = vi.fn(async () => ({ ok: true }));
    await mount(saveImage, [], deleteSavedImage);

    act(() => latest?.handleAttachFiles([imageFile('in-flight.png')]));
    await act(async () => {
      await vi.waitFor(() => expect(saveImage).toHaveBeenCalledTimes(1));
    });
    const id = latest?.attachments[0]?.id;
    act(() => latest?.removeAttachment(id!));
    await act(async () => {
      finishSave?.({ ok: true, filePath: '/tmp/orphan.png' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest?.attachments).toEqual([]);
    expect(deleteSavedImage).toHaveBeenCalledWith('workspace-a', '/tmp/orphan.png');
  });

  it('deletes a saved image when the user removes a ready attachment', async () => {
    const deleteSavedImage = vi.fn(async () => ({ ok: true }));
    await mount(vi.fn(), [{
      id: 'ready-image',
      path: '/tmp/ready.png',
      fileName: 'ready.png',
      mimeType: 'image/png',
      status: 'ready',
    }], deleteSavedImage);

    act(() => latest?.removeAttachment('ready-image'));
    await act(async () => Promise.resolve());

    expect(latest?.attachments).toEqual([]);
    expect(deleteSavedImage).toHaveBeenCalledWith('workspace-a', '/tmp/ready.png');
  });

  it('keeps the retry File across a hook remount for the same scope', async () => {
    const saveImage = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce({ ok: true, filePath: '/tmp/remounted.png' });
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { file: { saveImage } },
    });
    let setVisible: ((visible: boolean) => void) | undefined;
    const Child = ({
      attachments,
      setAttachments,
    }: {
      attachments: ChatImageAttachment[];
      setAttachments: Dispatch<SetStateAction<ChatImageAttachment[]>>;
    }) => {
      latest = useChatAttachments({ scopeId: 'workspace-a', attachments, setAttachments });
      return null;
    };
    const Parent = () => {
      const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
      const [visible, updateVisible] = useState(true);
      setVisible = updateVisible;
      return visible ? (
        <Child attachments={attachments} setAttachments={setAttachments} />
      ) : null;
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<I18nProvider><Parent /></I18nProvider>));

    act(() => latest?.handleAttachFiles([imageFile('remount.png')]));
    await waitForAttachmentStatus('failed');
    act(() => setVisible?.(false));
    act(() => setVisible?.(true));
    await act(async () => {
      latest?.retryAttachment(latest.attachments[0].id);
      await Promise.resolve();
    });
    await waitForAttachmentStatus('ready');

    expect(latest?.attachments[0]?.path).toBe('/tmp/remounted.png');
    expect(saveImage).toHaveBeenCalledTimes(2);
  });

  it('turns a retry without a retained File into a visible nonretryable failure', async () => {
    const saveImage = vi.fn();
    await mount(saveImage, [{
      id: 'missing-file',
      path: '',
      fileName: 'missing.png',
      mimeType: 'image/png',
      sizeBytes: 5,
      status: 'failed',
      error: 'temporary failure',
      retryable: true,
    }]);

    act(() => latest?.retryAttachment('missing-file'));

    expect(latest?.attachments[0]).toMatchObject({
      status: 'failed',
      retryable: false,
    });
    expect(latest?.attachments[0]?.error).not.toBe('');
    expect(saveImage).not.toHaveBeenCalled();
  });

  it('atomically reserves count across rapid calls and keeps overflow visible', async () => {
    const saveImage = vi.fn().mockResolvedValue({ ok: true, filePath: '/tmp/image.png' });
    await mount(saveImage);

    act(() => {
      latest?.handleAttachFiles([
        imageFile('one.png'),
        imageFile('two.png'),
        imageFile('three.png'),
        imageFile('four.png'),
      ]);
      latest?.handleAttachFiles([
        imageFile('five.png'),
        imageFile('six.png'),
        imageFile('seven.png'),
        imageFile('eight.png'),
      ]);
    });

    expect(latest?.attachments).toHaveLength(8);
    expect(latest?.attachments.filter(item => item.status === 'failed')).toHaveLength(2);
    expect(latest?.attachments.slice(6).every(item => item.retryable === false)).toBe(true);
    await act(async () => {
      await vi.waitFor(() => expect(saveImage).toHaveBeenCalledTimes(6));
    });
  });

  it('shares total-byte reservations across two hook instances for one scope', async () => {
    const saveImage = vi.fn().mockResolvedValue({ ok: true, filePath: '/tmp/image.png' });
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { file: { saveImage } },
    });
    const hooks: {
      first?: ReturnType<typeof useChatAttachments>;
      second?: ReturnType<typeof useChatAttachments>;
    } = {};
    const Probe = ({
      assign,
      attachments,
      setAttachments,
    }: {
      assign: (value: ReturnType<typeof useChatAttachments>) => void;
      attachments: ChatImageAttachment[];
      setAttachments: Dispatch<SetStateAction<ChatImageAttachment[]>>;
    }) => {
      assign(useChatAttachments({ scopeId: 'workspace-shared', attachments, setAttachments }));
      return null;
    };
    const Parent = () => {
      const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
      return (
        <>
          <Probe assign={value => { hooks.first = value; }} attachments={attachments} setAttachments={setAttachments} />
          <Probe assign={value => { hooks.second = value; }} attachments={attachments} setAttachments={setAttachments} />
        </>
      );
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<I18nProvider><Parent /></I18nProvider>));

    act(() => {
      hooks.first?.handleAttachFiles([
        imageFile('ten-a.png', 10 * 1024 * 1024),
        imageFile('ten-b.png', 10 * 1024 * 1024),
      ]);
      hooks.second?.handleAttachFiles([
        imageFile('ten-c.png', 10 * 1024 * 1024),
        imageFile('ten-d.png', 10 * 1024 * 1024),
      ]);
    });

    expect(hooks.first?.attachments).toHaveLength(4);
    expect(hooks.first?.attachments.map(item => item.status)).toEqual([
      'uploading',
      'uploading',
      'uploading',
      'failed',
    ]);
    expect(hooks.first?.attachments[3]).toMatchObject({ retryable: false });
    await act(async () => {
      await vi.waitFor(() => expect(saveImage).toHaveBeenCalledTimes(3));
    });
  });
});
