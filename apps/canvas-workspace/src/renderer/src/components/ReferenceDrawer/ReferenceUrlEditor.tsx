import type { Dispatch, RefObject, SetStateAction } from 'react';
import { LinkIcon } from './Icons';

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
}: ReferenceUrlEditorProps) => (
  <div className="reference-url-anchor" ref={urlEditorRef}>
    <button
      className={`reference-drawer-action reference-drawer-action--ghost${urlEditorOpen ? ' reference-drawer-action--open' : ''}`}
      type="button"
      onClick={() => {
        setUrlEditorOpen((prev) => !prev);
        setUrlError(undefined);
      }}
      aria-haspopup="dialog"
      aria-expanded={urlEditorOpen}
      title="Add URL reference"
    >
      <LinkIcon />
      URL
    </button>
    {urlEditorOpen && (
      <div className="reference-url-popover" role="dialog" aria-label="Add URL reference">
        <label className="reference-url-label" htmlFor="reference-url-input">Reference URL</label>
        <input
          id="reference-url-input"
          autoFocus
          className="reference-url-input"
          value={urlDraft}
          placeholder="https://example.com/article"
          onChange={(e) => {
            setUrlDraft(e.target.value);
            setUrlError(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddUrl();
            } else if (e.key === 'Escape') {
              setUrlEditorOpen(false);
            }
          }}
        />
        {urlError && <div className="reference-url-error">{urlError}</div>}
        <div className="reference-url-actions">
          <button
            type="button"
            className="reference-drawer-secondary"
            onClick={() => setUrlEditorOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="reference-drawer-primary"
            onClick={handleAddUrl}
            disabled={!urlDraft.trim()}
          >
            Add URL
          </button>
        </div>
      </div>
    )}
  </div>
);
