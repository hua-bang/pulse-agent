import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({ appOn: vi.fn() }));

vi.mock('electron', () => ({ app: { on: electronMocks.appOn } }));

type ContextMenuHandler = (event: unknown, params: Record<string, unknown>) => void;

function createGuest(type = 'webview', destroyed = false) {
  const hostWebContents = { isDestroyed: vi.fn(() => destroyed), send: vi.fn() };
  const contents = { id: 7, hostWebContents, getType: vi.fn(() => type), on: vi.fn() };
  return { contents, hostWebContents };
}

async function install() {
  const { setupWebviewContextMenu } = await import('../webview-context-menu');
  setupWebviewContextMenu();
  const handler = electronMocks.appOn.mock.calls.find(([event]) => event === 'web-contents-created')?.[1];
  if (typeof handler !== 'function') throw new Error('web-contents-created handler not registered');
  return handler as (_event: unknown, contents: ReturnType<typeof createGuest>['contents']) => void;
}

const menuHandlerOf = (contents: ReturnType<typeof createGuest>['contents']): ContextMenuHandler =>
  contents.on.mock.calls.find(([event]) => event === 'context-menu')?.[1] as ContextMenuHandler;

const params = (overrides: Record<string, unknown> = {}) => ({
  x: 120,
  y: 40,
  linkURL: 'https://example.com/target',
  srcURL: '',
  mediaType: 'none',
  selectionText: '',
  isEditable: false,
  ...overrides,
});

describe('webview context-menu relay', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMocks.appOn.mockReset();
  });

  it('forwards the click target to the embedder, tagged with its guest', async () => {
    const created = await install();
    const { contents, hostWebContents } = createGuest();
    created({}, contents);

    menuHandlerOf(contents)({}, params({ selectionText: 'some words' }));

    expect(hostWebContents.send).toHaveBeenCalledWith('webview:context-menu', {
      sourceWebContentsId: 7,
      x: 120,
      y: 40,
      linkURL: 'https://example.com/target',
      srcURL: '',
      mediaType: 'none',
      selectionText: 'some words',
      isEditable: false,
    });
  });

  it('ignores non-webview contents', async () => {
    const created = await install();
    const { contents } = createGuest('window');
    created({}, contents);

    expect(contents.on).not.toHaveBeenCalled();
  });

  it('drops the event when the embedder is gone', async () => {
    const created = await install();
    const { contents, hostWebContents } = createGuest('webview', true);
    created({}, contents);

    menuHandlerOf(contents)({}, params());

    expect(hostWebContents.send).not.toHaveBeenCalled();
  });
});
