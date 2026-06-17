import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { KnowledgeTagDefinition, WorkspaceNodeRecord } from '../../types';
import { tagName } from './utils';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useEscapeClose } from '../../hooks/useEscapeClose';

interface NodeTagEditorProps {
  node: WorkspaceNodeRecord;
  workspaceId: string;
  tags: string[];
  tagDefinitions: KnowledgeTagDefinition[];
  readOnly?: boolean;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
  onTagsChanged?: () => void;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueTagDefinitions(tags: KnowledgeTagDefinition[]): KnowledgeTagDefinition[] {
  const seen = new Set<string>();
  const result: KnowledgeTagDefinition[] = [];
  for (const tag of tags) {
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    result.push(tag);
  }
  return result;
}

export const NodeTagEditor = ({
  node,
  workspaceId,
  tags,
  tagDefinitions,
  readOnly,
  onNodePatched,
  onTagsChanged,
}: NodeTagEditorProps) => {
  const { t } = useI18n();
  const idBase = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => new Set(tags), [tags]);
  const query = normalizeText(input);
  const definitions = useMemo(() => uniqueTagDefinitions(tagDefinitions), [tagDefinitions]);
  const availableTags = useMemo(() => {
    return definitions
      .filter((tag) => !selected.has(tag.id))
      .filter((tag) => {
        if (!query) return true;
        return normalizeText(tag.name).includes(query) || normalizeText(tag.id).includes(query);
      })
      .slice(0, 8);
  }, [definitions, query, selected]);

  const exactMatch = useMemo(() => {
    if (!query) return null;
    return definitions.find((tag) => normalizeText(tag.name) === query || normalizeText(tag.id) === query) ?? null;
  }, [definitions, query]);
  const trimmedInput = input.trim();
  const options = useMemo(() => {
    const tagOptions = availableTags.map((tag) => ({ kind: 'tag' as const, key: `tag:${tag.id}`, tag }));
    if (trimmedInput && !exactMatch) {
      return [...tagOptions, { kind: 'create' as const, key: `create:${trimmedInput}` }];
    }
    return tagOptions;
  }, [availableTags, exactMatch, trimmedInput]);
  const listId = `${idBase}-tag-options`;
  const inputId = `${idBase}-tag-input`;
  const activeOptionId = open && activeIndex >= 0 && options[activeIndex]
    ? `${idBase}-tag-option-${activeIndex}`
    : undefined;

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closePicker = useCallback((restoreFocus = false) => {
    setOpen(false);
    setInput('');
    setActiveIndex(-1);
    if (restoreFocus) addButtonRef.current?.focus();
  }, []);

  useClickOutside(wrapperRef, () => closePicker(false), open);
  useEscapeClose(open, () => closePicker(true));

  useEffect(() => {
    if (!open) return;
    focusInput();
  }, [focusInput, open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(options.length > 0 ? 0 : -1);
  }, [open, options.length, query]);

  useEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionId]);

  const updateTags = async (nextTags: string[]) => {
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.updateTags(workspaceId, node.id, nextTags);
      if (!result.ok || !result.node) {
        setError(result.error ?? t('workspaceNodes.updateTagsFailed'));
        return;
      }
      onNodePatched?.(result.node);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addTag = async (tagId: string) => {
    if (!tagId || selected.has(tagId)) return;
    await updateTags([...tags, tagId]);
    setInput('');
    focusInput();
  };

  const removeTag = async (tagId: string) => {
    await updateTags(tags.filter((tag) => tag !== tagId));
  };

  const createOrAddFromInput = async () => {
    const name = trimmedInput;
    if (!name) return;
    if (exactMatch) {
      await addTag(exactMatch.id);
      return;
    }

    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.upsertTag({ name });
      if (!result.ok || !result.tag) {
        setError(result.error ?? t('workspaceNodes.createTagFailed'));
        return;
      }
      onTagsChanged?.();
      await addTag(result.tag.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const executeOption = useCallback(async (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.kind === 'create') {
      await createOrAddFromInput();
      return;
    }
    await addTag(option.tag.id);
  }, [addTag, createOrAddFromInput, options]);

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((current) => {
        if (event.key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % options.length;
        return current <= 0 ? options.length - 1 : current - 1;
      });
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (options.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePicker(true);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (activeIndex >= 0 && options[activeIndex]) {
        void executeOption(activeIndex);
        return;
      }
      void createOrAddFromInput();
    }
  }, [activeIndex, closePicker, createOrAddFromInput, executeOption, options]);

  return (
    <div className="node-tag-editor" ref={wrapperRef}>
      <div className="workspace-node-tags workspace-node-tags--editable">
        {tags.length > 0
          ? tags.map((tag) => (
            <span key={tag} className="workspace-node-tag workspace-node-tag--removable">
              {tagName(tag, definitions)}
              {!readOnly && (
                <button
                  type="button"
                  className="workspace-node-tag__remove"
                  aria-label={t('workspaceNodes.removeTag', { tag: tagName(tag, definitions) })}
                  disabled={saving}
                  onClick={() => { void removeTag(tag); }}
                >
                  x
                </button>
              )}
            </span>
          ))
          : <span className="workspace-node-muted">{t('workspaceNodes.noTags')}</span>}
        {!readOnly && (
          <button
            ref={addButtonRef}
            type="button"
            className="workspace-node-tag workspace-node-tag--add"
            disabled={saving}
            onClick={() => {
              if (open) {
                closePicker(false);
                return;
              }
              setOpen(true);
            }}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
          >
            {t('workspaceNodes.addTag')}
          </button>
        )}
      </div>

      {open && !readOnly && (
        <div
          className="node-tag-editor__picker"
          role="dialog"
          aria-label={t('workspaceNodes.tagPickerLabel')}
        >
          <input
            ref={inputRef}
            id={inputId}
            className="node-tag-editor__input"
            value={input}
            disabled={saving}
            placeholder={t('workspaceNodes.searchOrCreateTag')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <div className="node-tag-editor__options" id={listId} role="listbox" aria-label={t('workspaceNodes.tagOptionsLabel')}>
            {options.map((option, index) => option.kind === 'create' ? (
              <button
                key={option.key}
                id={`${idBase}-tag-option-${index}`}
                type="button"
                className={`node-tag-editor__option node-tag-editor__option--create${index === activeIndex ? ' node-tag-editor__option--active' : ''}`}
                disabled={saving}
                role="option"
                aria-selected={index === activeIndex}
                aria-label={t('workspaceNodes.createTagOption', { name: trimmedInput })}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => { void createOrAddFromInput(); }}
              >
                {t('workspaceNodes.createTag', { name: trimmedInput })}
              </button>
            ) : (
              <button
                key={option.key}
                id={`${idBase}-tag-option-${index}`}
                type="button"
                className={`node-tag-editor__option${index === activeIndex ? ' node-tag-editor__option--active' : ''}`}
                disabled={saving}
                title={option.tag.description}
                role="option"
                aria-selected={index === activeIndex}
                aria-label={t('workspaceNodes.addTagOption', { tag: option.tag.name })}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => { void addTag(option.tag.id); }}
              >
                <span>{option.tag.name}</span>
                <small>{option.tag.id}</small>
              </button>
            ))}
            {!options.length && !trimmedInput && (
              <div className="node-tag-editor__empty">{t('workspaceNodes.noTagsYet')}</div>
            )}
          </div>
          {error && <div className="node-tag-editor__error">{error}</div>}
        </div>
      )}
    </div>
  );
};
