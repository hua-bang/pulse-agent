import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { WorkspaceNodeRecord } from '../../types';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';

interface Props {
  node: WorkspaceNodeRecord;
  workspaceId: string;
  fallbackTitle: string;
  readOnly?: boolean;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
}

const cleanTitle = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const NodeTitleEditor = ({
  node,
  workspaceId,
  fallbackTitle,
  readOnly = false,
  onNodePatched,
}: Props) => {
  const { language, t } = useI18n();
  const persistedTitle = node.title ?? fallbackTitle;
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLHeadingElement | null>(null);
  const cancelBlurRef = useRef(false);
  const focusedRef = useRef(false);
  const dirtyRef = useRef(false);
  const requestSeqRef = useRef(0);
  const nodeIdRef = useRef(node.id);
  const persistedTitleRef = useRef(persistedTitle);
  persistedTitleRef.current = persistedTitle;

  useLayoutEffect(() => {
    const nodeChanged = nodeIdRef.current !== node.id;
    if (nodeChanged) {
      nodeIdRef.current = node.id;
      requestSeqRef.current += 1;
      dirtyRef.current = false;
    }
    // A previous save may resolve while the user has already focused the
    // title again and started the next draft. Update the persisted baseline,
    // but never replace that newer in-progress DOM text.
    if (!nodeChanged && focusedRef.current && dirtyRef.current) return;
    if (inputRef.current && inputRef.current.textContent !== persistedTitle) {
      inputRef.current.textContent = persistedTitle;
    }
    setError('');
  }, [node.id, persistedTitle]);

  const commit = async () => {
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false;
      return;
    }
    const input = inputRef.current;
    const nextTitle = cleanTitle(input?.textContent ?? '');
    if (!nextTitle) {
      dirtyRef.current = false;
      if (input) input.textContent = persistedTitleRef.current;
      return;
    }
    if (input) input.textContent = nextTitle;
    dirtyRef.current = false;
    if (nextTitle === persistedTitleRef.current) return;

    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api?.update) return;
    const requestId = ++requestSeqRef.current;
    const result = await api.update(workspaceId, node.id, { title: nextTitle }).catch((updateError) => ({
      ok: false as const,
      error: updateError instanceof Error ? updateError.message : String(updateError),
    }));
    if (requestId !== requestSeqRef.current) return;
    if (result.ok && result.node) {
      persistedTitleRef.current = result.node.title ?? nextTitle;
      setError('');
      onNodePatched?.(result.node);
      if (!focusedRef.current || !dirtyRef.current) {
        if (input) input.textContent = persistedTitleRef.current;
      }
      return;
    }
    if ((!focusedRef.current || !dirtyRef.current) && input) {
      input.textContent = persistedTitleRef.current;
    }
    setError(result.error ?? t('workspaceNodes.updateTitleFailed'));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLHeadingElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelBlurRef.current = true;
      dirtyRef.current = false;
      event.currentTarget.textContent = persistedTitleRef.current;
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  if (readOnly) {
    return <h1 className="node-detail-panel__document-title" lang={language}>{persistedTitle}</h1>;
  }

  return (
    <>
      <h1
        ref={inputRef}
        className="node-detail-panel__document-title"
        lang={language}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="false"
        aria-label={t('workspaceNodes.editTitle')}
        aria-invalid={!!error}
        onFocus={() => { focusedRef.current = true; }}
        onInput={() => {
          dirtyRef.current = true;
          if (error) setError('');
        }}
        onBlur={() => {
          focusedRef.current = false;
          void commit();
        }}
        onKeyDown={handleKeyDown}
        spellCheck={true}
      />
      {error && <span className="node-detail-panel__title-error" role="alert">{error}</span>}
    </>
  );
};
