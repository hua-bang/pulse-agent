import { useCallback, useEffect, useRef, type Dispatch, type FormEvent, type RefObject, type SetStateAction } from 'react';
import { LinkIcon } from './Icons';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useI18n } from '../../i18n';

interface ReferenceUrlEditorProps {
  handleAddUrl: () => void;
  setUrlDraft: (value: string) => void;
  setUrlEditorOpen: Dispatch<SetStateAction<boolean>>;
  setUrlError: (value: string | undefined) => void;
  urlDraft: string;
  urlEditorOpen: boolean;
  urlEditorRef: RefObject<HTMLDivElement>;
  urlError?: string;
}

export const ReferenceUrlEditor = ({
  handleAddUrl,
  setUrlDraft,
  setUrlEditorOpen,
  setUrlError,
  urlDraft,
  urlEditorOpen,
  urlEditorRef,
  urlError,
}: ReferenceUrlEditorProps) => {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusOnCloseRef = useRef(false);

  const closeEditor = useCallback((restoreFocus = false) => {
    restoreFocusOnCloseRef.current = restoreFocus;
    setUrlEditorOpen(false);
  }, [setUrlEditorOpen]);

  useEffect(() => {
    if (!urlEditorOpen) {
      if (restoreFocusOnCloseRef.current) {
        restoreFocusOnCloseRef.current = false;
        triggerRef.current?.focus();
      }
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [urlEditorOpen]);

  useEscapeClose(urlEditorOpen, () => closeEditor(true));

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!urlDraft.trim()) return;
    restoreFocusOnCloseRef.current = true;
    handleAddUrl();
    window.requestAnimationFrame(() => {
      if (inputRef.current) restoreFocusOnCloseRef.current = false;
    });
  }, [handleAddUrl, urlDraft]);

  return (
    <div className="reference-url-anchor" ref={urlEditorRef}>
      <button
        ref={triggerRef}
        className={`reference-drawer-action reference-drawer-action--ghost${urlEditorOpen ? ' reference-drawer-action--open' : ''}`}
        type="button"
        onClick={() => {
          setUrlEditorOpen((prev) => !prev);
          setUrlError(undefined);
        }}
        aria-haspopup="dialog"
        aria-expanded={urlEditorOpen}
        title={t('reference.addUrlReference')}
      >
        <LinkIcon />
        URL
      </button>
      {urlEditorOpen && (
        <form className="reference-url-popover" role="dialog" aria-label={t('reference.addUrlDialog')} onSubmit={handleSubmit}>
          <label className="reference-url-label" htmlFor="reference-url-input">{t('reference.urlLabel')}</label>
          <input
            ref={inputRef}
            id="reference-url-input"
            className="reference-url-input"
            value={urlDraft}
            placeholder={t('reference.urlPlaceholder')}
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? 'reference-url-error' : undefined}
            onChange={(e) => {
              setUrlDraft(e.target.value);
              setUrlError(undefined);
            }}
          />
          {urlError && <div id="reference-url-error" className="reference-url-error">{urlError}</div>}
          <div className="reference-url-actions">
            <button
              type="button"
              className="reference-drawer-secondary"
              onClick={() => closeEditor(true)}
            >
              {t('reference.cancel')}
            </button>
            <button
              type="submit"
              className="reference-drawer-primary"
              disabled={!urlDraft.trim()}
            >
              {t('reference.addUrl')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
