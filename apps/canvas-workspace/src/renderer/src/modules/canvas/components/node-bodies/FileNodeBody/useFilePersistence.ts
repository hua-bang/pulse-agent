import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasNode, FileNodeData } from '../../../../../types';

interface Options {
  nodeId: string;
  data: FileNodeData;
  readOnly: boolean;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void | Promise<void>;
  onReload: (content: string) => void;
  setModified: (modified: boolean) => void;
  onStatus: (state: 'saved' | 'error', conflict?: boolean) => void;
}

interface FileSession {
  nodeId: string;
  filePath: string;
  initialContent: string;
  active: boolean;
  dirty: boolean;
  conflict: boolean;
  versioned: boolean;
  baseline?: { content: string; version?: string };
  editSequence: number;
  saveSequence: number;
  readSequence: number;
  queue: Promise<void>;
  reading?: Promise<boolean>;
  queued: number;
  writing: boolean;
  refreshAfterWrite: boolean;
}

const hasDraft = (data: FileNodeData): boolean => Boolean(
  data.modified || ((data.fileWriteIntentId || data.fileWriteStatus) && data.fileWriteStatus !== 'applied'),
);

/** A byte-version baseline belongs to one node/file lifetime, never to a render. */
export function useFilePersistence(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const holder = useRef<FileSession | null>(null);
  const [conflicted, setConflicted] = useState(false);
  if (!holder.current || holder.current.nodeId !== options.nodeId || holder.current.filePath !== options.data.filePath) {
    const previous = holder.current;
    const materializingDraft = previous?.nodeId === options.nodeId && !previous.filePath
      && !!options.data.filePath && previous.dirty;
    if (holder.current) holder.current.active = false;
    holder.current = {
      nodeId: options.nodeId, filePath: options.data.filePath,
      initialContent: materializingDraft ? previous.initialContent : options.data.content ?? '',
      active: true, dirty: hasDraft(options.data) || materializingDraft, conflict: false, versioned: false,
      editSequence: materializingDraft ? previous.editSequence : 0, saveSequence: 0, readSequence: 0,
      queue: Promise.resolve(), queued: 0, writing: false, refreshAfterWrite: false,
    };
  }
  const session = holder.current;
  if (hasDraft(options.data)) session.dirty = true;
  const current = useCallback(() => session.active && holder.current === session, [session]);

  const fail = useCallback((conflict = false) => {
    session.conflict ||= conflict;
    if (!current()) return;
    setConflicted(session.conflict);
    if (session.dirty) latest.current.setModified(true);
    latest.current.onStatus('error', session.conflict);
  }, [current, session]);

  const refresh = useCallback((discard = false): Promise<boolean> => {
    if (!session.filePath || options.readOnly) return Promise.resolve(false);
    if (session.writing && !discard) {
      session.refreshAfterWrite = true;
      return Promise.resolve(false);
    }
    if (session.reading && !discard) return session.reading;
    const readSequence = ++session.readSequence;
    const editSequence = session.editSequence;
    const baseContent = session.dirty
      ? session.baseline?.content ?? session.initialContent
      : latest.current.data.content ?? '';
    const baseVersion = session.baseline?.content === baseContent ? session.baseline.version : undefined;
    const read = async (): Promise<boolean> => {
      const api = window.canvasWorkspace?.file;
      if (!api?.read) {
        // Compatibility with an older host that has no versioned read surface.
        session.baseline ??= { content: session.initialContent };
        return true;
      }
      try {
        if (discard) await session.queue;
        const result = await api.read(session.filePath);
        if (!current() || readSequence !== session.readSequence) return false;
        if (!result.ok || typeof result.content !== 'string'
          || (session.versioned && !result.version)) {
          fail();
          return false;
        }
        const sameBase = result.content === baseContent
          && (!baseVersion || result.version === baseVersion);
        if ((discard && editSequence !== session.editSequence)
          || (!discard && session.dirty && (session.conflict || !sameBase))) {
          fail(true);
          return false;
        }
        if (!session.dirty || discard) {
          const updateEditor = discard || latest.current.data.content !== result.content;
          if (updateEditor) {
            await latest.current.onUpdate(session.nodeId, {
              data: { ...latest.current.data, content: result.content, modified: false, saved: true },
            });
            if (!current() || readSequence !== session.readSequence) return false;
            if (editSequence !== session.editSequence) {
              fail(true);
              return false;
            }
            latest.current.onReload(result.content);
          }
          session.dirty = false;
          latest.current.setModified(false);
        }
        session.baseline = { content: result.content, version: result.version };
        session.versioned ||= typeof result.version === 'string';
        session.conflict = false;
        setConflicted(false);
        if (discard) latest.current.onStatus('saved');
        return true;
      } catch {
        if (current() && readSequence === session.readSequence) fail();
        return false;
      }
    };
    const pending = read().finally(() => {
      if (session.reading === pending) session.reading = undefined;
    });
    session.reading = pending;
    return pending;
  }, [current, fail, options.readOnly, session]);

  const persistToFile = useCallback(async (markdown: string, filePath: string) => {
    if (options.readOnly || filePath !== session.filePath || !filePath) return;
    const api = window.canvasWorkspace?.file;
    if (!api?.write) { fail(); return; }
    session.dirty = true;
    const saveSequence = ++session.saveSequence;
    const editSequence = session.editSequence;
    session.queued += 1;
    const operation = session.queue.catch(() => undefined).then(async () => {
      if (session.conflict) { fail(true); return; }
      if ((!session.baseline || (session.versioned && !session.baseline.version)) && !await refresh()) return;
      // A read started before this write must not later restore its old body
      // or replace the acknowledged version, even if it finishes last.
      session.readSequence += 1;
      session.reading = undefined;
      session.writing = true;
      try {
        const version = session.baseline?.version;
        const result = version === undefined
          ? await api.write(filePath, markdown)
          : await api.write(filePath, markdown, version);
        if (!result.ok) { fail(result.conflict); return; }
        // Even an outdated UI acknowledgement advances the actual file baseline
        // for the next queued write; it must not clear the newer editor draft.
        session.baseline = { content: markdown, version: result.version };
        session.versioned ||= typeof result.version === 'string';
        if (!current() || saveSequence !== session.saveSequence || editSequence !== session.editSequence) return;
        await latest.current.onUpdate(session.nodeId, {
          data: { ...latest.current.data, content: markdown, saved: true, modified: false },
        });
        if (!current() || saveSequence !== session.saveSequence || editSequence !== session.editSequence) return;
        latest.current.onReload(markdown);
        session.dirty = false;
        latest.current.setModified(false);
        latest.current.onStatus('saved');
      } catch {
        fail();
      } finally {
        session.writing = false;
      }
    }).finally(() => {
      session.queued -= 1;
      if (session.queued === 0 && session.refreshAfterWrite && current() && !session.conflict) {
        session.refreshAfterWrite = false;
        void refresh();
      }
    });
    session.queue = operation;
    await operation;
  }, [current, fail, options.readOnly, refresh, session]);

  const markDirty = useCallback(() => {
    session.editSequence += 1;
    session.dirty = true;
    latest.current.setModified(true);
  }, [session]);

  useEffect(() => {
    session.active = true;
    setConflicted(false);
    latest.current.setModified(session.dirty);
    if (!options.readOnly && session.filePath) void refresh();
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribe = window.canvasWorkspace?.file?.onChanged?.((filePath) => {
      if (filePath === session.filePath) void refresh();
    });
    return () => {
      session.active = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe?.();
    };
  }, [options.readOnly, refresh, session]);

  useEffect(() => {
    if (!options.readOnly && !session.dirty && session.baseline
      && options.data.content !== session.baseline.content) void refresh();
  }, [options.data.content, options.readOnly, refresh, session]);

  return { persistToFile, markDirty, refresh, conflicted, discardAndReload: () => refresh(true) };
}
