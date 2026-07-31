import {
  getFrozenSince,
  setWebviewLifecycle,
  type FreezableWebContents,
} from './lifecycle';
import {
  beginLifecycleRequest,
  serializeLifecycleTransition,
} from './lifecycle-request-guard';

/**
 * Temporarily resumes a frozen guest so agent DOM extraction can execute.
 * A renderer lifecycle intent that arrives during the read supersedes this
 * lease, preventing the cleanup from freezing a page the user just opened.
 */
export async function withTemporarilyActiveWebview<T>(
  wc: FreezableWebContents,
  webContentsId: number,
  isCurrentIdentity: () => boolean,
  read: () => Promise<T>,
): Promise<T> {
  if (getFrozenSince(wc) === undefined) return read();

  const request = beginLifecycleRequest(webContentsId);
  await serializeLifecycleTransition(webContentsId, async () => {
    if (!request.isCurrent() || !isCurrentIdentity() || wc.isDestroyed()) return;
    await setWebviewLifecycle(wc, 'active');
  });

  try {
    return await read();
  } finally {
    try {
      await serializeLifecycleTransition(webContentsId, async () => {
        if (!request.isCurrent() || !isCurrentIdentity() || wc.isDestroyed()) return;
        await setWebviewLifecycle(wc, 'frozen');
      });
    } finally {
      request.finish();
    }
  }
}
